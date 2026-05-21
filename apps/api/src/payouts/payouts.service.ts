import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type AdminPendingPayout,
  type DisbursePayoutInput,
  type JobLedgerEntry,
  type Page,
  type PayoutEntryStatus,
} from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type EntryRow = Prisma.JobLedgerEntryGetPayload<Record<string, never>>;

interface ListQuery {
  limit: number;
  sort: 'asc' | 'desc';
  cursor?: string;
  status?: PayoutEntryStatus;
}

/**
 * Read + sweep operations over `JobLedgerEntry`. Minting is owned by
 * `ServiceJobsService.completeForPartner`; this service handles every
 * downstream read (partner payouts, owner charges) and the sweep that
 * flips HELD payouts to RELEASED once the cooldown elapses.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  async listPayoutsForPartner(
    partnerUserId: string,
    query: ListQuery,
  ): Promise<Page<JobLedgerEntry>> {
    return this.paginate(
      {
        kind: 'PAYOUT',
        accountUserId: partnerUserId,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async listChargesForOwner(ownerId: string, query: ListQuery): Promise<Page<JobLedgerEntry>> {
    return this.paginate(
      {
        kind: 'CHARGE',
        accountUserId: ownerId,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  /**
   * Flip every HELD PAYOUT row whose cooldown has elapsed to RELEASED.
   * One audit row per row. Idempotent — re-running on already-released
   * rows is a no-op because the where clause filters them out.
   *
   * Called from the BullMQ sweeper; safe to invoke from a unit spec.
   */
  async releaseEligible(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.jobLedgerEntry.findMany({
      where: {
        kind: 'PAYOUT',
        status: 'HELD',
        cooldownUntil: { lt: now },
      },
      select: {
        id: true,
        jobId: true,
        amount: true,
        currency: true,
        cooldownUntil: true,
      },
    });
    let released = 0;
    for (const row of due) {
      await this.prisma.$transaction(async (tx) => {
        await tx.jobLedgerEntry.update({
          where: { id: row.id },
          data: { status: 'RELEASED', releasedAt: now },
        });
        await this.audit.write(tx, {
          actorId: null,
          action: 'payout.release',
          target: `JobLedgerEntry:${row.id}`,
          meta: {
            jobId: row.jobId,
            amount: row.amount,
            currency: row.currency,
            cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
          },
        });
      });
      released += 1;
    }
    if (released > 0) this.logger.log(`released ${released} payout(s)`);
    return released;
  }

  // ---- Admin disbursement (Phase 7.6) -----------------------------

  /**
   * Admin queue of RELEASED PAYOUT entries waiting on a bank transfer.
   * Joins the partner's User + PartnerProfile so the page renders
   * without per-row lookups. Sorted oldest-released first so the
   * partner who's been waiting longest gets paid first.
   */
  async listAdminPending(query: ListQuery): Promise<Page<AdminPendingPayout>> {
    const limit = query.limit;
    const findArgs: Prisma.JobLedgerEntryFindManyArgs = {
      where: { kind: 'PAYOUT', status: 'RELEASED' },
      orderBy: [{ releasedAt: query.sort }, { id: query.sort }],
      take: limit + 1,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = await this.prisma.jobLedgerEntry.findMany(findArgs);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    // Resolve partner names in one batched query keyed on User.id.
    const partnerIds = Array.from(
      new Set(items.map((r) => r.accountUserId).filter((id): id is string => id !== null)),
    );
    const partners =
      partnerIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: partnerIds } },
            select: {
              id: true,
              displayName: true,
              partnerProfile: { select: { businessName: true } },
            },
          });
    const byId = new Map(partners.map((p) => [p.id, p]));

    return {
      items: items.map((r): AdminPendingPayout => {
        const partner = r.accountUserId ? byId.get(r.accountUserId) : undefined;
        return {
          ...toResponse(r),
          partnerUserId: r.accountUserId ?? '',
          partnerName: partner?.displayName ?? '(unknown)',
          partnerBusinessName: partner?.partnerProfile?.businessName ?? null,
        };
      }),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Owner of the disbursement state transition. RELEASED → DISBURSED
   * with the bank reference captured. Stripe Connect rejected with
   * 501 until that flow is wired.
   */
  async markDisbursed(
    entryId: string,
    input: DisbursePayoutInput,
    ctx: RequestContext,
  ): Promise<JobLedgerEntry> {
    const row = await this.prisma.jobLedgerEntry.findUnique({ where: { id: entryId } });
    if (row?.kind !== 'PAYOUT') {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.PAYOUT_ENTRY_NOT_FOUND,
        title: 'Payout entry not found',
      });
    }

    if (row.status === 'DISBURSED') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYOUT_ALREADY_DISBURSED,
        title: 'Payout entry already disbursed',
      });
    }
    if (row.status === 'HELD') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYOUT_NOT_DISBURSABLE_HELD,
        title: 'Payout still in cooldown',
        detail: 'Wait for the sweeper to flip this row to RELEASED.',
      });
    }
    if (row.status !== 'RELEASED') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PAYOUT_NOT_DISBURSABLE,
        title: 'Payout entry is not in a disbursable state',
        detail: `Status is ${row.status}; only RELEASED rows can be disbursed.`,
      });
    }

    if (input.method === 'STRIPE_CONNECT') {
      throw new ProblemError({
        status: 501,
        type: ErrorCodes.PAYOUT_DISBURSEMENT_METHOD_UNSUPPORTED,
        title: 'Stripe Connect disbursement is not wired in this deployment',
        detail:
          'Use MANUAL_BANK_TRANSFER for now. Stripe Connect needs a partner onboarding flow that lands in a later slice.',
      });
    }

    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.jobLedgerEntry.update({
        where: { id: entryId },
        data: {
          status: 'DISBURSED',
          disbursedAt: now,
          disbursementMethod: input.method,
          disbursementRef: input.reference,
          disbursedById: ctx.actorId,
        },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'payout.disburse',
        target: `JobLedgerEntry:${next.id}`,
        meta: {
          jobId: next.jobId,
          accountUserId: next.accountUserId,
          amount: next.amount,
          currency: next.currency,
          method: input.method,
          reference: input.reference,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return next;
    });

    return toResponse(updated);
  }

  // ---- helpers -----------------------------------------------------

  private async paginate(
    where: Prisma.JobLedgerEntryWhereInput,
    query: ListQuery,
  ): Promise<Page<JobLedgerEntry>> {
    const limit = query.limit;
    const findArgs: Prisma.JobLedgerEntryFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = await this.prisma.jobLedgerEntry.findMany(findArgs);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }
}

function toResponse(row: EntryRow): JobLedgerEntry {
  return {
    id: row.id,
    jobId: row.jobId,
    kind: row.kind,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    accountUserId: row.accountUserId,
    cooldownUntil: row.cooldownUntil ? row.cooldownUntil.toISOString() : null,
    releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
    disbursedAt: row.disbursedAt ? row.disbursedAt.toISOString() : null,
    disbursementRef: row.disbursementRef,
    disbursementMethod: row.disbursementMethod,
    disbursedById: row.disbursedById,
    createdAt: row.createdAt.toISOString(),
  };
}
