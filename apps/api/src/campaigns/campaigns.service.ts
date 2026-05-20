import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { type Campaign, type CampaignStatus, ErrorCodes, type Page, type Role } from '@repo/shared';

import type {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  TransitionCampaignDto,
  UpdateCampaignDto,
} from './dto/campaigns.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const CAMPAIGN_WITH_UNIT = {
  include: { unit: { select: { houseId: true } } },
} satisfies Prisma.CampaignDefaultArgs;

type CampaignRow = Prisma.CampaignGetPayload<typeof CAMPAIGN_WITH_UNIT>;

/**
 * Owner-side transitions only. Admin transitions (PENDING → LIVE /
 * REJECTED) land in 4.2 in a separate code path so the permission
 * gate stays trivial here.
 */
const OWNER_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['PENDING'],
  PENDING: ['DRAFT'],
  LIVE: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
  EXPIRED: [],
};

const ACTION_FOR_TRANSITION: Record<CampaignStatus, string> = {
  PENDING: 'campaign.submit',
  DRAFT: 'campaign.withdraw',
  CLOSED: 'campaign.close',
  LIVE: 'campaign.publish', // admin-only path; included for completeness
  REJECTED: 'campaign.reject',
  EXPIRED: 'campaign.expire',
};

/**
 * Campaigns service.
 *
 * Authorization (4.1 scope):
 * - **Owner** of the parent house — full CRUD + owner-side transitions
 *   on campaigns under their own units. Cross-owner access → 404 to
 *   match the existence-hiding pattern from `leases` / `houses`.
 * - **Admin** — read any (mutations land in 4.2).
 * - **Tenant / Partner** — no access yet.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Owner-scoped (nested under unit) -----------------------------

  async createForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    input: CreateCampaignDto,
  ): Promise<Campaign> {
    const { house } = await this.assertOwnerOfUnit(actor, houseId, unitId);
    const created = await this.prisma.campaign.create({
      data: {
        unitId,
        ownerId: house.ownerId,
        title: input.title,
        body: input.body,
        price: input.price,
        currency: input.currency,
        photos: input.photos ?? [],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: 'DRAFT',
      },
      ...CAMPAIGN_WITH_UNIT,
    });
    return this.toResponse(created);
  }

  async listForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    query: ListCampaignsQueryDto,
  ): Promise<Page<Campaign>> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    return this.paginate(
      {
        unitId,
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
  ): Promise<Campaign> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    const row = await this.findCampaignOnUnit(id, unitId);
    return this.toResponse(row);
  }

  async updateDraft(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    patch: UpdateCampaignDto,
  ): Promise<Campaign> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);
    if (existing.status !== 'DRAFT') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.CAMPAIGN_NOT_DRAFT,
        title: 'Campaign is not editable',
        detail: 'Only DRAFT campaigns can be edited.',
      });
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
        ...(patch.price !== undefined && { price: patch.price }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.photos !== undefined && { photos: patch.photos }),
        ...(patch.expiresAt !== undefined && {
          expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : null,
        }),
      },
      ...CAMPAIGN_WITH_UNIT,
    });
    return this.toResponse(updated);
  }

  async transition(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    input: TransitionCampaignDto,
    ctx: RequestContext,
  ): Promise<Campaign> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);

    if (!OWNER_TRANSITIONS[existing.status].includes(input.to)) {
      throw this.invalidTransition(existing.status, input.to);
    }

    // Submitting: enforce one LIVE per unit and that the unit is VACANT.
    if (input.to === 'PENDING') {
      await this.assertUnitVacantForSubmit(unitId, id);
    }

    const previousStatus = existing.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.campaign.update({
        where: { id },
        data: { status: input.to },
        ...CAMPAIGN_WITH_UNIT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: ACTION_FOR_TRANSITION[input.to],
        target: `Campaign:${id}`,
        meta: { previousStatus, unitId, houseId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return row;
    });
    return this.toResponse(updated);
  }

  async softDelete(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
  ): Promise<void> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);
    if (existing.status !== 'DRAFT' && existing.status !== 'CLOSED') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.CAMPAIGN_INVALID_TRANSITION,
        title: 'Cannot delete in current state',
        detail: 'Only DRAFT or CLOSED campaigns can be deleted.',
      });
    }
    await this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---- Admin-scoped (read-only here; mutations in 4.2) --------------

  async getAny(id: string): Promise<Campaign> {
    const row = await this.prisma.campaign.findUnique({
      where: { id },
      ...CAMPAIGN_WITH_UNIT,
    });
    if (!row || row.deletedAt) throw this.notFound();
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async paginate(
    where: Prisma.CampaignWhereInput,
    query: ListCampaignsQueryDto,
  ): Promise<Page<Campaign>> {
    const limit = query.limit;
    const findArgs: Prisma.CampaignFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...CAMPAIGN_WITH_UNIT,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.campaign.findMany(findArgs)) as CampaignRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async assertUnitVacantForSubmit(unitId: string, ignoreCampaignId: string): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { status: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt || unit.status !== 'VACANT') {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.CAMPAIGN_UNIT_NOT_VACANT,
        title: 'Unit is not vacant',
        detail: 'End or terminate the active lease before submitting a campaign.',
      });
    }
    const live = await this.prisma.campaign.count({
      where: { unitId, status: 'LIVE', deletedAt: null, NOT: { id: ignoreCampaignId } },
    });
    if (live > 0) {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.CAMPAIGN_UNIT_NOT_VACANT,
        title: 'Unit already has a live campaign',
        detail: 'Close the live campaign before submitting another for the same unit.',
      });
    }
  }

  private async assertOwnerOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<{ house: { id: string; ownerId: string }; unit: { id: string; houseId: string } }> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { id: true, ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    if (actor.id !== unit.house.ownerId) throw this.notFound();
    return {
      house: { id: unit.house.id, ownerId: unit.house.ownerId },
      unit: { id: unit.id, houseId: unit.houseId },
    };
  }

  private async assertOwnerOrAdminOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && actor.id !== unit.house.ownerId) throw this.notFound();
  }

  private async findCampaignOnUnit(id: string, unitId: string): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findUnique({ where: { id }, ...CAMPAIGN_WITH_UNIT });
    if (!row || row.deletedAt || row.unitId !== unitId) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.CAMPAIGN_NOT_FOUND,
      title: 'Campaign not found',
    });
  }

  private invalidTransition(from: CampaignStatus, to: CampaignStatus): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.CAMPAIGN_INVALID_TRANSITION,
      title: 'Invalid campaign transition',
      detail: `Cannot move campaign from ${from} to ${to}.`,
    });
  }

  private toResponse(row: CampaignRow): Campaign {
    return {
      id: row.id,
      ownerId: row.ownerId,
      unitId: row.unitId,
      houseId: row.unit.houseId,
      title: row.title,
      body: row.body,
      price: row.price,
      currency: row.currency,
      photos: row.photos,
      status: row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      moderationReason: row.moderationReason,
      moderationDecidedAt: row.moderationDecidedAt ? row.moderationDecidedAt.toISOString() : null,
      moderationDecidedBy: row.moderationDecidedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

export const CAMPAIGN_OWNER_TRANSITIONS = OWNER_TRANSITIONS;
