import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationTopic,
  type JobStatus,
  type Page,
  type ServiceJob,
} from '@repo/shared';

import type {
  CancelServiceJobDto,
  CompleteServiceJobDto,
  CreateServiceJobDto,
  ListServiceJobsQueryDto,
  QuoteServiceJobDto,
} from './dto/service-jobs.dto.js';
import { AnalyticsService } from '../common/analytics/analytics.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlatformConfigService } from '../platform/platform-config.service.js';

const JOB_WITH_RELATIONS = {
  include: {
    partner: { select: { businessName: true, userId: true, deletedAt: true } },
    service: { select: { name: true } },
  },
} satisfies Prisma.ServiceJobDefaultArgs;

type JobRow = Prisma.ServiceJobGetPayload<typeof JOB_WITH_RELATIONS>;

/**
 * Owner-side transitions. Maps `target → previous statuses` so
 * `OWNER_TRANSITIONS[next].includes(existing.status)` is the canonical
 * "can I do this?" check.
 */
const OWNER_TRANSITIONS: Record<'ACCEPTED' | 'CANCELLED', JobStatus[]> = {
  ACCEPTED: ['QUOTED'],
  CANCELLED: ['REQUESTED', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS'],
};

const PARTNER_TRANSITIONS: Record<
  'QUOTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
  JobStatus[]
> = {
  QUOTED: ['REQUESTED'],
  IN_PROGRESS: ['ACCEPTED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['REQUESTED', 'QUOTED', 'ACCEPTED', 'IN_PROGRESS'],
};

/**
 * Service jobs (direct booking — 5.2).
 *
 * Authorization is two-sided:
 * - **OWNER** (`ownerId`): requests, accepts the quote, cancels.
 * - **PARTNER** (partner.userId): quotes, starts, completes, cancels.
 *
 * Each mutation runs in a `$transaction` with its paired audit row.
 * Cross-party access returns 404 (existence-hiding), matching the
 * leases / campaigns conventions.
 */
@Injectable()
export class ServiceJobsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // ---- Owner-scoped ------------------------------------------------

  async createForOwner(
    ownerId: string,
    input: CreateServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const partner = await this.prisma.partnerProfile.findUnique({
      where: { id: input.partnerId },
      select: {
        id: true,
        deletedAt: true,
        user: { select: { isSuspended: true, deletedAt: true } },
      },
    });
    if (
      !partner ||
      partner.deletedAt ||
      !partner.user ||
      partner.user.isSuspended ||
      partner.user.deletedAt
    ) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.JOB_PARTNER_NOT_BOOKABLE,
        title: 'Partner is not bookable',
      });
    }

    // Ticket-routed booking (5.3): validate the ticket belongs to this
    // owner and is in a bookable state; derive the unit from its lease
    // (server is source-of-truth, client-supplied unitId is ignored).
    let resolvedUnitId: string | null = input.unitId ?? null;
    if (input.ticketId !== undefined) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: input.ticketId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          lease: { select: { ownerId: true, unitId: true } },
        },
      });
      if (!ticket || ticket.deletedAt || ticket.lease.ownerId !== ownerId) {
        throw this.notFound();
      }
      if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        throw new ProblemError({
          status: 422,
          type: ErrorCodes.JOB_TICKET_NOT_BOOKABLE,
          title: 'Ticket is not bookable',
          detail: 'Re-open the ticket before requesting a partner.',
        });
      }
      resolvedUnitId = ticket.lease.unitId;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.serviceJob.create({
        data: {
          ownerId,
          partnerId: input.partnerId,
          serviceId: input.serviceId ?? null,
          unitId: resolvedUnitId,
          ticketId: input.ticketId ?? null,
          description: input.description ?? null,
          scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
          status: 'REQUESTED',
        },
        ...JOB_WITH_RELATIONS,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.request',
        target: `ServiceJob:${row.id}`,
        meta: {
          partnerId: input.partnerId,
          serviceId: input.serviceId ?? null,
          unitId: resolvedUnitId,
          ticketId: input.ticketId ?? null,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return row;
    });
    return this.toResponse(created);
  }

  async listForOwner(ownerId: string, query: ListServiceJobsQueryDto): Promise<Page<ServiceJob>> {
    return this.paginate(
      {
        ownerId,
        ...(query.status !== undefined && { status: query.status }),
        ...(query.ticketId !== undefined && { ticketId: query.ticketId }),
      },
      query,
    );
  }

  async getForOwner(ownerId: string, id: string): Promise<ServiceJob> {
    const row = await this.findOrFail(id);
    if (row.ownerId !== ownerId) throw this.notFound();
    return this.toResponse(row);
  }

  async acceptForOwner(ownerId: string, id: string, ctx: RequestContext): Promise<ServiceJob> {
    const existing = await this.findOrFail(id);
    if (existing.ownerId !== ownerId) throw this.notFound();
    if (!OWNER_TRANSITIONS.ACCEPTED.includes(existing.status)) {
      throw this.invalidTransition(existing.status, 'ACCEPTED');
    }
    const previousStatus = existing.status;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceJob.update({
        where: { id },
        data: { status: 'ACCEPTED' },
        ...JOB_WITH_RELATIONS,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.accept',
        target: `ServiceJob:${id}`,
        meta: { previousStatus },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async cancelForOwner(
    ownerId: string,
    id: string,
    input: CancelServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const existing = await this.findOrFail(id);
    if (existing.ownerId !== ownerId) throw this.notFound();
    return this.cancelInternal(existing, input, ctx);
  }

  // ---- Partner-scoped ----------------------------------------------

  async listForPartner(
    partnerUserId: string,
    query: ListServiceJobsQueryDto,
  ): Promise<Page<ServiceJob>> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    return this.paginate(
      {
        partnerId,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForPartner(partnerUserId: string, id: string): Promise<ServiceJob> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    const row = await this.findOrFail(id);
    if (row.partnerId !== partnerId) throw this.notFound();
    return this.toResponse(row);
  }

  async quoteForPartner(
    partnerUserId: string,
    id: string,
    input: QuoteServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    const existing = await this.findOrFail(id);
    if (existing.partnerId !== partnerId) throw this.notFound();
    if (!PARTNER_TRANSITIONS.QUOTED.includes(existing.status)) {
      throw this.invalidTransition(existing.status, 'QUOTED');
    }
    const previousStatus = existing.status;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceJob.update({
        where: { id },
        data: {
          status: 'QUOTED',
          quotedAmount: input.amount,
          currency: input.currency,
        },
        ...JOB_WITH_RELATIONS,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.quote',
        target: `ServiceJob:${id}`,
        meta: { previousStatus, amount: input.amount, currency: input.currency },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async startForPartner(
    partnerUserId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    const existing = await this.findOrFail(id);
    if (existing.partnerId !== partnerId) throw this.notFound();
    if (!PARTNER_TRANSITIONS.IN_PROGRESS.includes(existing.status)) {
      throw this.invalidTransition(existing.status, 'IN_PROGRESS');
    }
    const previousStatus = existing.status;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceJob.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
        ...JOB_WITH_RELATIONS,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.start',
        target: `ServiceJob:${id}`,
        meta: { previousStatus },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async completeForPartner(
    partnerUserId: string,
    id: string,
    input: CompleteServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    const existing = await this.findOrFail(id);
    if (existing.partnerId !== partnerId) throw this.notFound();
    if (!PARTNER_TRANSITIONS.COMPLETED.includes(existing.status)) {
      throw this.invalidTransition(existing.status, 'COMPLETED');
    }
    const previousStatus = existing.status;
    const finalAmount = input.finalAmount ?? existing.quotedAmount ?? 0;
    const proofPhotos = input.proofPhotos ?? existing.proofPhotos;
    // Currency is set at quote time. Default to '___' as a never-reached
    // fallback so the FK lands; we throw above if quote was skipped.
    const currency = existing.currency ?? null;
    if (currency === null) {
      throw new ProblemError({
        status: 500,
        type: ErrorCodes.INTERNAL_ERROR,
        title: 'Job has no currency',
        detail: 'Currency is set at quote time; this state should be unreachable.',
      });
    }
    // Phase 9.6: rate now lives in `PlatformConfig`. Read once per
    // mint so a concurrent rate change applies to the next job, not
    // this one (no "rate change mid-tx" surprises).
    const { commissionBps } = await this.platformConfig.get();
    const commission = computeCommission(finalAmount, commissionBps);
    const partnerCut = finalAmount - commission;
    const now = new Date();
    const cooldownUntil = new Date(now.getTime() + PAYOUT_COOLDOWN_MS);
    const { row, enqueue } = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceJob.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          finalAmount,
          proofPhotos,
          completedAt: now,
        },
        ...JOB_WITH_RELATIONS,
      });

      // Defensive double-mint guard. The PARTNER_TRANSITIONS guard above
      // already prevents reaching here twice for a single job, but a
      // belt-and-braces check costs one indexed lookup.
      const alreadyMinted = await tx.jobLedgerEntry.count({
        where: { jobId: id, kind: 'CHARGE' },
      });
      if (alreadyMinted > 0) {
        throw new ProblemError({
          status: 500,
          type: ErrorCodes.INTERNAL_ERROR,
          title: 'Ledger already minted',
        });
      }

      // `0 - x` instead of `-x` so `finalAmount === 0` produces `+0`
      // and doesn't surface a `-0` quirk through equality comparisons.
      const chargeAmount = 0 - finalAmount;
      await tx.jobLedgerEntry.createMany({
        data: [
          {
            jobId: id,
            kind: 'CHARGE',
            status: 'PENDING',
            amount: chargeAmount,
            currency,
            accountUserId: existing.ownerId,
          },
          {
            jobId: id,
            kind: 'COMMISSION',
            status: 'PENDING',
            amount: commission,
            currency,
            accountUserId: null,
          },
          {
            jobId: id,
            kind: 'PAYOUT',
            status: 'HELD',
            amount: partnerCut,
            currency,
            accountUserId: partnerUserId,
            cooldownUntil,
          },
        ],
      });

      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.complete',
        target: `ServiceJob:${id}`,
        meta: {
          previousStatus,
          finalAmount,
          commission,
          partnerCut,
          proofPhotosCount: proofPhotos.length,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.ledger_minted',
        target: `ServiceJob:${id}`,
        meta: { finalAmount, commission, partnerCut, currency },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.JOB_COMPLETED,
        recipientId: existing.ownerId,
        data: {
          jobId: id,
          partnerName: updated.partner.businessName,
          finalAmount,
          currency,
        },
      });
      return { row: updated, enqueue: dispatch.enqueue };
    });
    await enqueue();
    // Partner-keyed event so the per-role PostHog filter slices job
    // completions out of the firehose. `commission` + `partner_cut`
    // are inline so PostHog dashboards can chart platform-vs-partner
    // share without joining elsewhere.
    this.analytics.capture({
      userId: partnerUserId,
      event: 'job.completed',
      properties: {
        role: 'PARTNER',
        job_id: id,
        final_amount: finalAmount,
        currency,
        commission,
        partner_cut: partnerCut,
      },
    });
    return this.toResponse(row);
  }

  async cancelForPartner(
    partnerUserId: string,
    id: string,
    input: CancelServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    const partnerId = await this.partnerIdFromUser(partnerUserId);
    const existing = await this.findOrFail(id);
    if (existing.partnerId !== partnerId) throw this.notFound();
    return this.cancelInternal(existing, input, ctx);
  }

  // ---- helpers -----------------------------------------------------

  private async cancelInternal(
    existing: JobRow,
    input: CancelServiceJobDto,
    ctx: RequestContext,
  ): Promise<ServiceJob> {
    if (!OWNER_TRANSITIONS.CANCELLED.includes(existing.status)) {
      throw this.invalidTransition(existing.status, 'CANCELLED');
    }
    const previousStatus = existing.status;
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.serviceJob.update({
        where: { id: existing.id },
        data: {
          status: 'CANCELLED',
          cancelReason: input.reason,
          cancelledBy: ctx.actorId,
        },
        ...JOB_WITH_RELATIONS,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'job.cancel',
        target: `ServiceJob:${existing.id}`,
        meta: { previousStatus, reason: input.reason, cancelledBy: ctx.actorId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  private async partnerIdFromUser(userId: string): Promise<string> {
    const profile = await this.prisma.partnerProfile.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!profile || profile.deletedAt) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.PARTNER_PROFILE_NOT_FOUND,
        title: 'Partner profile not found',
      });
    }
    return profile.id;
  }

  private async paginate(
    where: Prisma.ServiceJobWhereInput,
    query: ListServiceJobsQueryDto,
  ): Promise<Page<ServiceJob>> {
    const limit = query.limit;
    const findArgs: Prisma.ServiceJobFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...JOB_WITH_RELATIONS,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.serviceJob.findMany(findArgs)) as JobRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async findOrFail(id: string): Promise<JobRow> {
    const row = await this.prisma.serviceJob.findUnique({
      where: { id },
      ...JOB_WITH_RELATIONS,
    });
    if (!row) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.JOB_NOT_FOUND,
      title: 'Job not found',
    });
  }

  private invalidTransition(from: JobStatus, to: JobStatus): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.JOB_INVALID_TRANSITION,
      title: 'Invalid job transition',
      detail: `Cannot move job from ${from} to ${to}.`,
    });
  }

  private toResponse(row: JobRow): ServiceJob {
    return {
      id: row.id,
      ownerId: row.ownerId,
      partnerId: row.partnerId,
      partnerBusinessName: row.partner.businessName,
      serviceId: row.serviceId,
      serviceName: row.service?.name ?? null,
      ticketId: row.ticketId,
      unitId: row.unitId,
      status: row.status,
      description: row.description,
      quotedAmount: row.quotedAmount,
      finalAmount: row.finalAmount,
      currency: row.currency,
      scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      cancelReason: row.cancelReason,
      cancelledBy: row.cancelledBy,
      proofPhotos: row.proofPhotos,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export const SERVICE_JOB_OWNER_TRANSITIONS = OWNER_TRANSITIONS;
export const SERVICE_JOB_PARTNER_TRANSITIONS = PARTNER_TRANSITIONS;

/**
 * Schema default for the platform commission rate. The canonical
 * source is `PlatformConfig.commissionBps` (Phase 9.6); this constant
 * stays exported because the unit specs that construct a stub
 * `PlatformConfigService` still want a stable literal.
 *
 * 1000 bps = 10%.
 */
export const DEFAULT_COMMISSION_BPS = 1000;
export const PAYOUT_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Pure-function commission math. Floor toward zero so the partner
 * picks up rounding remainders. The bps rate is a required arg —
 * callers pass it explicitly so the policy is visible at the call
 * site instead of buried in a module constant.
 */
export function computeCommission(finalAmount: number, bps: number): number {
  if (finalAmount <= 0) return 0;
  return Math.floor((finalAmount * bps) / 10_000);
}
