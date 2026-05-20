import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { type Application, ErrorCodes, type Page } from '@repo/shared';

import type {
  CreateApplicationDto,
  ListApplicationsQueryDto,
  RejectApplicationDto,
} from './dto/applications.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const APPLICATION_WITH_APPLICANT = {
  include: { applicant: { select: { displayName: true } } },
} satisfies Prisma.ApplicationDefaultArgs;

type ApplicationRow = Prisma.ApplicationGetPayload<typeof APPLICATION_WITH_APPLICANT>;

/** 24h sliding window. Five is a generous-but-not-spammy default. */
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

/**
 * Applications service.
 *
 * Multi-party authorization:
 * - **TENANT**: applies + reads + withdraws own. POST guards: campaign
 *   must be LIVE, tenant != owner, < 5 applications in the last 24h.
 * - **OWNER** of the parent house: lists / reads / accepts / rejects.
 *   Accept is the heavy transaction — see `acceptForOwner`.
 * - **ADMIN**: not in this slice.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Tenant -------------------------------------------------------

  async createForTenant(
    tenantId: string,
    input: CreateApplicationDto,
    ctx: RequestContext,
  ): Promise<Application> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: input.campaignId },
      select: {
        id: true,
        status: true,
        ownerId: true,
        deletedAt: true,
        unitId: true,
        unit: { select: { houseId: true } },
      },
    });
    if (!campaign || campaign.deletedAt) throw this.campaignNotLive();
    if (campaign.status !== 'LIVE') throw this.campaignNotLive();
    if (campaign.ownerId === tenantId) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.APPLICATION_SELF,
        title: 'Cannot apply to your own listing',
      });
    }

    // 24h sliding-window rate limit.
    const recent = await this.prisma.application.count({
      where: {
        applicantId: tenantId,
        createdAt: { gte: new Date(Date.now() - RATE_LIMIT_WINDOW_MS) },
      },
    });
    if (recent >= RATE_LIMIT_MAX) {
      throw new ProblemError({
        status: 429,
        type: ErrorCodes.APPLICATION_RATE_LIMITED,
        title: 'Too many applications',
        detail: `Limit is ${RATE_LIMIT_MAX} applications per 24h.`,
        retryAfter: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
      });
    }

    let created: ApplicationRow;
    try {
      created = await this.prisma.application.create({
        data: {
          campaignId: input.campaignId,
          applicantId: tenantId,
          ownerId: campaign.ownerId,
          status: 'SUBMITTED',
          message: input.message ?? null,
        },
        ...APPLICATION_WITH_APPLICANT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ProblemError({
          status: 409,
          type: ErrorCodes.APPLICATION_DUPLICATE,
          title: 'Already applied',
          detail: 'You already have an application on this campaign.',
        });
      }
      throw err;
    }

    // Best-effort audit after the row commits — not in a transaction because
    // duplicate-key handling above would have swallowed it. Failures here
    // shouldn't block the application.
    await this.audit.writeOnce({
      actorId: ctx.actorId,
      action: 'application.submit',
      target: `Application:${created.id}`,
      meta: {
        campaignId: campaign.id,
        unitId: campaign.unitId,
        houseId: campaign.unit.houseId,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.toResponse(created);
  }

  async listForTenant(
    tenantId: string,
    query: ListApplicationsQueryDto,
  ): Promise<Page<Application>> {
    return this.paginate(
      {
        applicantId: tenantId,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForTenant(tenantId: string, id: string): Promise<Application> {
    const row = await this.findOrFail(id);
    if (row.applicantId !== tenantId) throw this.notFound();
    return this.toResponse(row);
  }

  async withdrawForTenant(tenantId: string, id: string, ctx: RequestContext): Promise<Application> {
    const existing = await this.findOrFail(id);
    if (existing.applicantId !== tenantId) throw this.notFound();
    if (existing.status !== 'SUBMITTED' && existing.status !== 'REVIEWING') {
      throw this.notDecidable();
    }
    const previousStatus = existing.status;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id },
        data: { status: 'WITHDRAWN' },
        ...APPLICATION_WITH_APPLICANT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'application.withdraw',
        target: `Application:${id}`,
        meta: { previousStatus, campaignId: existing.campaignId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  // ---- Owner --------------------------------------------------------

  async listForOwner(
    ownerId: string,
    campaignId: string,
    query: ListApplicationsQueryDto,
  ): Promise<Page<Application>> {
    await this.assertOwnerOfCampaign(ownerId, campaignId);
    return this.paginate(
      {
        campaignId,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForOwner(ownerId: string, campaignId: string, id: string): Promise<Application> {
    await this.assertOwnerOfCampaign(ownerId, campaignId);
    const row = await this.findOrFail(id);
    if (row.campaignId !== campaignId) throw this.notFound();
    return this.toResponse(row);
  }

  async acceptForOwner(
    ownerId: string,
    campaignId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<Application> {
    await this.assertOwnerOfCampaign(ownerId, campaignId);

    // Reload everything we touch inside the transaction-bound checks.
    const application = await this.findOrFail(id);
    if (application.campaignId !== campaignId) throw this.notFound();
    if (application.status !== 'SUBMITTED' && application.status !== 'REVIEWING') {
      throw this.notDecidable();
    }
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        unitId: true,
        currency: true,
        price: true,
        unit: { select: { houseId: true, status: true } },
      },
    });
    if (!campaign) throw this.campaignNotLive();
    if (campaign.status !== 'LIVE') throw this.campaignNotLive();
    if (campaign.unit.status !== 'VACANT') {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.CAMPAIGN_UNIT_NOT_VACANT,
        title: 'Unit is not vacant',
        detail: 'End or terminate the active lease before accepting an application.',
      });
    }

    const previousStatus = application.status;
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      // 1) Mint the DRAFT lease from the campaign's economics.
      const lease = await tx.lease.create({
        data: {
          unitId: campaign.unitId,
          ownerId: campaign.ownerId,
          tenantId: application.applicantId,
          status: 'DRAFT',
          rentCycle: 'MONTHLY',
          rentAmount: campaign.price,
          depositAmount: campaign.price,
          currency: campaign.currency,
          startDate: now,
          endDate: null,
        },
      });

      // 2) Flip the accepted application + remember the lease.
      const updated = await tx.application.update({
        where: { id },
        data: {
          status: 'ACCEPTED',
          decidedBy: ctx.actorId,
          decidedAt: now,
          createdLeaseId: lease.id,
        },
        ...APPLICATION_WITH_APPLICANT,
      });

      // 3) Close the campaign — the listing is filled.
      await tx.campaign.update({
        where: { id: campaignId },
        data: { status: 'CLOSED' },
      });

      // 4) Auto-reject every other open application on this campaign.
      const siblings = await tx.application.findMany({
        where: {
          campaignId,
          id: { not: id },
          status: { in: ['SUBMITTED', 'REVIEWING'] },
        },
        select: { id: true, status: true },
      });
      for (const s of siblings) {
        await tx.application.update({
          where: { id: s.id },
          data: {
            status: 'REJECTED',
            decidedBy: ctx.actorId,
            decidedAt: now,
            rejectionReason: 'Listing was filled.',
          },
        });
        await this.audit.write(tx, {
          actorId: ctx.actorId,
          action: 'application.auto_reject',
          target: `Application:${s.id}`,
          meta: { previousStatus: s.status, campaignId, cause: 'sibling_accepted' },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
      }

      // 5) Audit the accept + the lease create with full provenance.
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'application.accept',
        target: `Application:${id}`,
        meta: {
          previousStatus,
          campaignId,
          unitId: campaign.unitId,
          houseId: campaign.unit.houseId,
          leaseId: lease.id,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'lease.create_from_application',
        target: `Lease:${lease.id}`,
        meta: {
          applicationId: id,
          campaignId,
          unitId: campaign.unitId,
          houseId: campaign.unit.houseId,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      return updated;
    });
    return this.toResponse(row);
  }

  async rejectForOwner(
    ownerId: string,
    campaignId: string,
    id: string,
    input: RejectApplicationDto,
    ctx: RequestContext,
  ): Promise<Application> {
    await this.assertOwnerOfCampaign(ownerId, campaignId);
    const existing = await this.findOrFail(id);
    if (existing.campaignId !== campaignId) throw this.notFound();
    if (existing.status !== 'SUBMITTED' && existing.status !== 'REVIEWING') {
      throw this.notDecidable();
    }
    const previousStatus = existing.status;
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: ctx.actorId,
          decidedAt: now,
          rejectionReason: input.reason,
        },
        ...APPLICATION_WITH_APPLICANT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'application.reject',
        target: `Application:${id}`,
        meta: { previousStatus, reason: input.reason, campaignId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async paginate(
    where: Prisma.ApplicationWhereInput,
    query: ListApplicationsQueryDto,
  ): Promise<Page<Application>> {
    const limit = query.limit;
    const findArgs: Prisma.ApplicationFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...APPLICATION_WITH_APPLICANT,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.application.findMany(findArgs)) as ApplicationRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async findOrFail(id: string): Promise<ApplicationRow> {
    const row = await this.prisma.application.findUnique({
      where: { id },
      ...APPLICATION_WITH_APPLICANT,
    });
    if (!row) throw this.notFound();
    return row;
  }

  private async assertOwnerOfCampaign(ownerId: string, campaignId: string): Promise<void> {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { ownerId: true, deletedAt: true },
    });
    if (!campaign || campaign.deletedAt) throw this.notFound();
    if (campaign.ownerId !== ownerId) throw this.notFound();
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.APPLICATION_NOT_FOUND,
      title: 'Application not found',
    });
  }

  private notDecidable(): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.APPLICATION_NOT_DECIDABLE,
      title: 'Application is not in a decidable state',
      detail: 'Only SUBMITTED or REVIEWING applications can change state.',
    });
  }

  private campaignNotLive(): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.APPLICATION_CAMPAIGN_NOT_LIVE,
      title: 'Campaign is not accepting applications',
    });
  }

  private toResponse(row: ApplicationRow): Application {
    return {
      id: row.id,
      campaignId: row.campaignId,
      ownerId: row.ownerId,
      applicantId: row.applicantId,
      applicantName: row.applicant.displayName,
      status: row.status,
      message: row.message,
      rejectionReason: row.rejectionReason,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      decidedBy: row.decidedBy,
      createdLeaseId: row.createdLeaseId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const APPLICATION_RATE_LIMIT_WINDOW_MS = RATE_LIMIT_WINDOW_MS;
export const APPLICATION_RATE_LIMIT_MAX = RATE_LIMIT_MAX;
