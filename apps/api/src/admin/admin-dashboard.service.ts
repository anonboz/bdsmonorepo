import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { MoneyByCurrency, PlatformDashboard } from '@repo/shared';

import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const OPEN_TICKET_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REOPENED'] as const;
const OVERDUE_BILL_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const;

/**
 * Platform dashboard aggregator. Single endpoint, parallel queries, math
 * in JS — mirrors the owner-dashboard service. Scale assumption: fine
 * while the platform has < ~10k users / ~10k bills; beyond that the
 * GMV all-time scan needs a SQL `SUM(...) GROUP BY currency` or a
 * materialized table.
 */
@Injectable()
export class AdminDashboardService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async getSnapshot(): Promise<PlatformDashboard> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
    const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

    const [
      userCounts,
      houseCounts,
      leaseCounts,
      ticketCounts,
      ticketResolveSamples,
      gmvRows,
      gmvLast30dRows,
      overdueRows,
      overdueCount,
    ] = await Promise.all([
      this.userCounts(sevenDaysAgo, thirtyDaysAgo),
      this.houseCounts(),
      this.leaseCounts(),
      this.ticketCounts(sevenDaysAgo),
      this.ticketResolveSamples(thirtyDaysAgo),
      this.gmvByCurrency({}),
      this.gmvByCurrency({ updatedAt: { gte: thirtyDaysAgo } }),
      this.overdueByCurrency(now),
      this.prisma.bill.count({ where: overdueBillsWhere(now) }),
    ]);

    return {
      users: userCounts,
      houses: houseCounts,
      leases: leaseCounts,
      tickets: {
        ...ticketCounts,
        medianResolveMs: computeMedianMs(ticketResolveSamples),
      },
      gmvAllTime: sumByCurrency(gmvRows),
      gmvLast30d: sumByCurrency(gmvLast30dRows),
      overdue: { count: overdueCount, byCurrency: sumByCurrency(overdueRows) },
      generatedAt: now.toISOString(),
    };
  }

  // ---- per-section queries -----------------------------------------

  private async userCounts(sevenDaysAgo: Date, thirtyDaysAgo: Date) {
    const [total, suspended, pendingKyc, activeIn7d, activeIn30d] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, isSuspended: true } }),
      this.prisma.user.count({ where: { deletedAt: null, kycStatus: 'PENDING' } }),
      this.prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: sevenDaysAgo } } }),
      this.prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: thirtyDaysAgo } } }),
    ]);
    return { total, suspended, pendingKyc, activeIn7d, activeIn30d };
  }

  private async houseCounts() {
    const [total, published, flagged, rejected] = await Promise.all([
      this.prisma.house.count({ where: { deletedAt: null } }),
      this.prisma.house.count({ where: { deletedAt: null, isPublished: true } }),
      this.prisma.house.count({ where: { deletedAt: null, moderationStatus: 'FLAGGED' } }),
      this.prisma.house.count({ where: { deletedAt: null, moderationStatus: 'REJECTED' } }),
    ]);
    return { total, published, flagged, rejected };
  }

  private async leaseCounts() {
    const [active, draft] = await Promise.all([
      this.prisma.lease.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.lease.count({ where: { deletedAt: null, status: 'DRAFT' } }),
    ]);
    return { active, draft };
  }

  private async ticketCounts(sevenDaysAgo: Date) {
    const [openCount, resolvedLast7d] = await Promise.all([
      this.prisma.ticket.count({
        where: { deletedAt: null, status: { in: [...OPEN_TICKET_STATUSES] } },
      }),
      this.prisma.ticket.count({
        where: { deletedAt: null, resolvedAt: { gte: sevenDaysAgo } },
      }),
    ]);
    return { openCount, resolvedLast7d };
  }

  private async ticketResolveSamples(since: Date): Promise<number[]> {
    const rows = await this.prisma.ticket.findMany({
      where: { deletedAt: null, resolvedAt: { gte: since } },
      select: { createdAt: true, resolvedAt: true },
    });
    const samples: number[] = [];
    for (const r of rows) {
      if (r.resolvedAt == null) continue;
      const ms = r.resolvedAt.getTime() - r.createdAt.getTime();
      samples.push(Math.max(0, ms));
    }
    return samples;
  }

  private async gmvByCurrency(extra: Prisma.BillWhereInput): Promise<MoneyByCurrency[]> {
    const rows = await this.prisma.bill.findMany({
      where: { status: 'PAID', lease: { deletedAt: null }, ...extra },
      select: { total: true, currency: true },
    });
    return rows.map((r) => ({ currency: r.currency, amount: r.total }));
  }

  private async overdueByCurrency(now: Date): Promise<MoneyByCurrency[]> {
    const rows = await this.prisma.bill.findMany({
      where: overdueBillsWhere(now),
      select: { total: true, currency: true },
    });
    return rows.map((r) => ({ currency: r.currency, amount: r.total }));
  }
}

// ---- helpers ---------------------------------------------------------

function overdueBillsWhere(now: Date): Prisma.BillWhereInput {
  return {
    lease: { deletedAt: null },
    status: { in: [...OVERDUE_BILL_STATUSES] },
    dueDate: { lt: now },
  };
}

/**
 * Sum the (already-fetched) per-row money amounts into one row per
 * currency. Exported for unit specs.
 */
export function sumByCurrency(rows: MoneyByCurrency[]): MoneyByCurrency[] {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount);
  }
  return Array.from(byCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
}

/**
 * Standard median: average of the two middle elements when `samples`
 * has an even length. Returns `null` for an empty list so the UI can
 * show "—".
 */
export function computeMedianMs(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return Math.round(sorted[mid]!);
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}
