import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { BillDashboardItem, OwnerDashboard } from '@repo/shared';

import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/**
 * Owner dashboard aggregator. Single-request, parallel queries over the
 * owner's houses → units → leases → bills graph.
 *
 * Math sits in this file (not pushed to SQL) for two reasons:
 *  1. Per-currency MRR normalization needs the rentCycle multipliers,
 *     awkward in raw SQL.
 *  2. Counts are small enough that fetching rows + reducing in JS is
 *     simpler than `GROUP BY` and stays portable across Postgres versions.
 *
 * Scale assumption: this is fine while an owner has < ~10k bills total.
 * Beyond that, push the recent/overdue queries to indexed `findMany` with
 * cursor pagination instead of full-table scans (we're already limited
 * to 10 rows; the table size is the only concern).
 */
@Injectable()
export class OwnerDashboardService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async getForOwner(ownerId: string): Promise<OwnerDashboard> {
    // Pull the owner's house ids first — every other query scopes to this set.
    const houses = await this.prisma.house.findMany({
      where: { ownerId, deletedAt: null },
      select: { id: true },
    });
    const houseIds = houses.map((h) => h.id);

    if (houseIds.length === 0) {
      return emptyDashboard();
    }

    // Fire the rest in parallel — they don't depend on each other.
    const [units, leases, overdueBills, recentBills, overdueCount] = await Promise.all([
      this.prisma.unit.findMany({
        where: { houseId: { in: houseIds }, deletedAt: null },
        select: { status: true },
      }),
      this.prisma.lease.findMany({
        where: { ownerId, status: 'ACTIVE', deletedAt: null },
        select: { tenantId: true, rentCycle: true, rentAmount: true, currency: true },
      }),
      this.prisma.bill.findMany({
        where: overdueBillsWhere(ownerId, new Date()),
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        take: 10,
        ...BILL_FOR_DASHBOARD,
      }),
      this.prisma.bill.findMany({
        where: { lease: { ownerId, deletedAt: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        ...BILL_FOR_DASHBOARD,
      }),
      this.prisma.bill.count({ where: overdueBillsWhere(ownerId, new Date()) }),
    ]);

    return {
      occupancy: computeOccupancy(units),
      mrr: computeMrr(leases),
      counts: {
        houses: houseIds.length,
        units: units.length,
        activeLeases: leases.length,
        tenants: new Set(leases.map((l) => l.tenantId)).size,
        overdueBills: overdueCount,
      },
      overdueBills: overdueBills.map(toDashboardItem),
      recentBills: recentBills.map(toDashboardItem),
    };
  }
}

// ---- Query helpers ----------------------------------------------------

const BILL_FOR_DASHBOARD = {
  include: {
    lease: {
      select: {
        tenant: { select: { displayName: true } },
        unit: {
          select: {
            id: true,
            label: true,
            houseId: true,
            house: { select: { name: true } },
          },
        },
      },
    },
  },
} satisfies Prisma.BillDefaultArgs;

type BillRow = Prisma.BillGetPayload<typeof BILL_FOR_DASHBOARD>;

function overdueBillsWhere(ownerId: string, now: Date): Prisma.BillWhereInput {
  return {
    lease: { ownerId, deletedAt: null },
    status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
    dueDate: { lt: now },
  };
}

function toDashboardItem(row: BillRow): BillDashboardItem {
  return {
    id: row.id,
    leaseId: row.leaseId,
    unitId: row.lease.unit.id,
    houseId: row.lease.unit.houseId,
    unitLabel: row.lease.unit.label,
    houseName: row.lease.unit.house.name,
    tenantName: row.lease.tenant.displayName,
    periodStart: row.periodStart.toISOString().slice(0, 10),
    periodEnd: row.periodEnd.toISOString().slice(0, 10),
    dueDate: row.dueDate.toISOString().slice(0, 10),
    status: row.status,
    total: row.total,
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---- Pure aggregation functions (exported for unit specs) ------------

export function computeOccupancy(units: { status: string }[]): OwnerDashboard['occupancy'] {
  const occupied = units.filter((u) => u.status === 'OCCUPIED').length;
  const total = units.length;
  const rate = total === 0 ? 0 : Math.round((occupied / total) * 10_000) / 10_000;
  return { occupied, total, rate };
}

const MONTHLY_MULTIPLIER: Record<string, number> = {
  WEEKLY: 4.333,
  MONTHLY: 1,
  QUARTERLY: 1 / 3,
  YEARLY: 1 / 12,
};

export function computeMrr(
  leases: { rentCycle: string; rentAmount: number; currency: string }[],
): OwnerDashboard['mrr'] {
  const byCurrency = new Map<string, number>();
  for (const l of leases) {
    const mult = MONTHLY_MULTIPLIER[l.rentCycle] ?? 1;
    const monthly = Math.round(l.rentAmount * mult);
    byCurrency.set(l.currency, (byCurrency.get(l.currency) ?? 0) + monthly);
  }
  // Stable ordering by currency code for predictable UIs.
  return Array.from(byCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
}

function emptyDashboard(): OwnerDashboard {
  return {
    occupancy: { occupied: 0, total: 0, rate: 0 },
    mrr: [],
    counts: {
      houses: 0,
      units: 0,
      activeLeases: 0,
      tenants: 0,
      overdueBills: 0,
    },
    overdueBills: [],
    recentBills: [],
  };
}
