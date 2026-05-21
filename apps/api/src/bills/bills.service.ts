import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationTopic,
  type Bill,
  type BillLine,
  type Page,
  type Role,
} from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { NotificationsService } from '../notifications/notifications.service.js';

type BillRow = Prisma.BillGetPayload<{ include: { lines: true } }>;

const BILL_WITH_LINES = {
  include: { lines: { orderBy: { createdAt: 'asc' } } },
} satisfies Prisma.BillDefaultArgs;

export interface GenerateOptions {
  /**
   * ISO date string for the period start. Defaults to the start of the
   * current calendar month for MONTHLY leases (other cycles map similarly).
   */
  periodStart?: string;
}

export type BillGenerationSource = 'owner' | 'sweeper';

export interface GenerationContext {
  /** Authenticated user when initiated by a human; `null` for worker calls. */
  actorId: string | null;
  source: BillGenerationSource;
  ip?: string | null;
  userAgent?: string | null;
}

export interface GenerationResult {
  bill: Bill;
  status: 'created' | 'idempotent';
}

/**
 * Bills service.
 *
 * The hot path is `generateForLease()`. It's a *pure function over Prisma* —
 * no Bull dependency, no scheduling logic — so it can be called from:
 * - The `bills.generate` worker (queue consumer).
 * - The owner's "Generate now" controller (synchronous from HTTP).
 * - A unit spec (with a stubbed PrismaInstance).
 *
 * Idempotency is enforced at the DB level via `@@unique([leaseId, idempotencyKey])`.
 * When the unique constraint fires (P2002) we read the existing bill and
 * return it with `status: 'idempotent'`, making the whole operation safe
 * to retry from any caller.
 */
@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Generation ---------------------------------------------------

  async generateForLease(
    leaseId: string,
    opts: GenerateOptions = {},
    ctx: GenerationContext = { actorId: null, source: 'sweeper' },
  ): Promise<GenerationResult> {
    const lease = await this.prisma.lease.findUnique({ where: { id: leaseId } });
    if (!lease || lease.deletedAt) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.LEASE_NOT_FOUND,
        title: 'Lease not found',
      });
    }
    if (lease.status !== 'ACTIVE') {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.BILL_LEASE_NOT_ACTIVE,
        title: 'Lease is not active',
        detail: `Cannot generate a bill for a lease in ${lease.status} state.`,
      });
    }

    const periodStart = opts.periodStart
      ? new Date(opts.periodStart)
      : currentPeriodStart(lease.rentCycle);
    const periodEnd = periodEndFor(periodStart, lease.rentCycle);
    const dueDate = new Date(periodStart);
    dueDate.setUTCDate(dueDate.getUTCDate() + 7);

    const idempotencyKey = buildIdempotencyKey(lease.rentCycle, periodStart);

    try {
      // Create the bill + audit row atomically. Audit only fires on a
      // genuinely-new bill — the duplicate branch below intentionally
      // skips writing so a retry doesn't double-log the same period.
      // We also persist the bill.issued notification inside the same tx
      // so a worker failure can't leave us with a bill and no inbox
      // row — the BullMQ enqueue runs after commit.
      const { created, enqueue } = await this.prisma.$transaction(async (tx) => {
        const row = await tx.bill.create({
          data: {
            leaseId,
            idempotencyKey,
            periodStart,
            periodEnd,
            dueDate,
            issuedAt: new Date(),
            status: 'ISSUED',
            currency: lease.currency,
            subtotal: lease.rentAmount,
            total: lease.rentAmount,
            lines: {
              create: [
                {
                  kind: 'RENT',
                  label: `Rent · ${formatPeriod(periodStart, periodEnd)}`,
                  amount: lease.rentAmount,
                  quantity: 1,
                },
              ],
            },
          },
          ...BILL_WITH_LINES,
        });
        await this.audit.write(tx, {
          actorId: ctx.actorId,
          action: 'bill.generate',
          target: `Bill:${row.id}`,
          meta: {
            leaseId,
            idempotencyKey,
            periodStart: periodStart.toISOString().slice(0, 10),
            source: ctx.source,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        const dispatch = await this.notifications.dispatch(tx, {
          topic: NotificationTopic.BILL_ISSUED,
          recipientId: lease.tenantId,
          data: {
            billId: row.id,
            leaseId,
            amount: row.total,
            currency: row.currency,
            dueDate: row.dueDate.toISOString().slice(0, 10),
            period: formatPeriod(periodStart, periodEnd),
          },
        });
        return { created: row, enqueue: dispatch.enqueue };
      });
      await enqueue();
      this.logger.log(`created bill ${created.id} for lease ${leaseId} period ${idempotencyKey}`);
      return { bill: this.toResponse(created), status: 'created' };
    } catch (err) {
      if (this.isLeasePeriodConflict(err)) {
        const existing = await this.prisma.bill.findUnique({
          where: { leaseId_idempotencyKey: { leaseId, idempotencyKey } },
          ...BILL_WITH_LINES,
        });
        if (!existing) {
          // Should be impossible — the constraint just fired — but rethrow to
          // surface the inconsistency rather than return undefined.
          throw err;
        }
        this.logger.log(
          `idempotent bill ${existing.id} for lease ${leaseId} period ${idempotencyKey}`,
        );
        return { bill: this.toResponse(existing), status: 'idempotent' };
      }
      throw err;
    }
  }

  /** Returns every ACTIVE lease id whose current period has no bill yet. */
  async findLeasesNeedingBillFor(
    now: Date = new Date(),
  ): Promise<{ leaseId: string; periodStart: string }[]> {
    const leases = await this.prisma.lease.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      select: { id: true, rentCycle: true },
    });

    const out: { leaseId: string; periodStart: string }[] = [];
    for (const lease of leases) {
      const periodStart = currentPeriodStart(lease.rentCycle, now);
      const idempotencyKey = buildIdempotencyKey(lease.rentCycle, periodStart);
      const existing = await this.prisma.bill.findUnique({
        where: { leaseId_idempotencyKey: { leaseId: lease.id, idempotencyKey } },
        select: { id: true },
      });
      if (!existing) {
        out.push({ leaseId: lease.id, periodStart: periodStart.toISOString().slice(0, 10) });
      }
    }
    return out;
  }

  // ---- Reads --------------------------------------------------------

  async listForLease(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
    query: { limit: number; sort: 'asc' | 'desc'; cursor?: string; status?: string },
  ): Promise<Page<Bill>> {
    await this.assertOwnerOrAdminOfLease(actor, houseId, unitId, leaseId);
    return this.paginate(
      { leaseId, ...(query.status !== undefined && { status: query.status as Bill['status'] }) },
      query,
    );
  }

  async getForLease(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
    id: string,
  ): Promise<Bill> {
    await this.assertOwnerOrAdminOfLease(actor, houseId, unitId, leaseId);
    const row = await this.prisma.bill.findUnique({ where: { id }, ...BILL_WITH_LINES });
    if (row?.leaseId !== leaseId) throw this.notFound();
    return this.toResponse(row);
  }

  async listForTenant(
    tenantId: string,
    query: { limit: number; sort: 'asc' | 'desc'; cursor?: string; status?: string },
  ): Promise<Page<Bill>> {
    return this.paginate(
      {
        lease: { tenantId, deletedAt: null },
        ...(query.status !== undefined && { status: query.status as Bill['status'] }),
      },
      query,
    );
  }

  async getForTenant(tenantId: string, id: string): Promise<Bill> {
    const row = await this.prisma.bill.findUnique({
      where: { id },
      ...BILL_WITH_LINES,
      include: { lines: { orderBy: { createdAt: 'asc' } }, lease: { select: { tenantId: true } } },
    });
    if (row?.lease.tenantId !== tenantId) throw this.notFound();
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async assertOwnerOrAdminOfLease(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<void> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        id: true,
        unitId: true,
        ownerId: true,
        deletedAt: true,
        unit: { select: { houseId: true, deletedAt: true } },
      },
    });
    if (!lease || lease.deletedAt || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.notFound();
    }
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && actor.id !== lease.ownerId) throw this.notFound();
  }

  private async paginate(
    where: Prisma.BillWhereInput,
    query: { limit: number; sort: 'asc' | 'desc'; cursor?: string },
  ): Promise<Page<Bill>> {
    const limit = query.limit;
    const findArgs: Prisma.BillFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...BILL_WITH_LINES,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.bill.findMany(findArgs)) as BillRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private isLeasePeriodConflict(err: unknown): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (err.code !== 'P2002') return false;
    const target = (err.meta?.target as string[] | undefined) ?? [];
    return target.includes('leaseId') && target.includes('idempotencyKey');
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.BILL_NOT_FOUND,
      title: 'Bill not found',
    });
  }

  private toResponse(row: BillRow): Bill {
    return {
      id: row.id,
      leaseId: row.leaseId,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      periodEnd: row.periodEnd.toISOString().slice(0, 10),
      dueDate: row.dueDate.toISOString().slice(0, 10),
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      status: row.status,
      subtotal: row.subtotal,
      total: row.total,
      currency: row.currency,
      lines: row.lines.map(
        (l): BillLine => ({
          id: l.id,
          billId: l.billId,
          kind: l.kind,
          label: l.label,
          amount: l.amount,
          quantity: l.quantity,
          createdAt: l.createdAt.toISOString(),
        }),
      ),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

// ---- Period math (exported for unit specs) ---------------------------

type RentCycle = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export function currentPeriodStart(cycle: RentCycle, now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch (cycle) {
    case 'WEEKLY': {
      // Anchor on Monday UTC.
      const day = d.getUTCDay(); // 0 = Sun
      const diff = (day + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diff);
      return d;
    }
    case 'MONTHLY':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    case 'QUARTERLY': {
      const q = Math.floor(d.getUTCMonth() / 3);
      return new Date(Date.UTC(d.getUTCFullYear(), q * 3, 1));
    }
    case 'YEARLY':
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  }
}

export function periodEndFor(periodStart: Date, cycle: RentCycle): Date {
  const d = new Date(periodStart);
  switch (cycle) {
    case 'WEEKLY':
      d.setUTCDate(d.getUTCDate() + 6);
      return d;
    case 'MONTHLY':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    case 'QUARTERLY':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 0));
    case 'YEARLY':
      return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 0));
  }
}

export function buildIdempotencyKey(cycle: RentCycle, periodStart: Date): string {
  return `${cycle}:${periodStart.toISOString().slice(0, 10)}`;
}

function formatPeriod(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(start)} – ${fmt(end)}`;
}
