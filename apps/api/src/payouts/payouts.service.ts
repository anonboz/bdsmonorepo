import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { JobLedgerEntry, Page, PayoutEntryStatus } from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
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
    createdAt: row.createdAt.toISOString(),
  };
}
