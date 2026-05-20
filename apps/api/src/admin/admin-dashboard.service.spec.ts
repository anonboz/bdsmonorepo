import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminDashboardService,
  computeMedianMs,
  sumByCurrency,
} from './admin-dashboard.service.js';

describe('sumByCurrency', () => {
  it('returns empty for empty input', () => {
    expect(sumByCurrency([])).toEqual([]);
  });

  it('sums per currency and sorts by currency code', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amount: 100 },
        { currency: 'VND', amount: 50_000 },
        { currency: 'USD', amount: 200 },
      ]),
    ).toEqual([
      { currency: 'USD', amount: 300 },
      { currency: 'VND', amount: 50_000 },
    ]);
  });
});

describe('computeMedianMs', () => {
  it('null for empty samples', () => {
    expect(computeMedianMs([])).toBeNull();
  });

  it('odd length picks the middle', () => {
    expect(computeMedianMs([100, 200, 300])).toBe(200);
  });

  it('even length averages the two middles', () => {
    expect(computeMedianMs([100, 200, 300, 400])).toBe(250);
  });

  it('handles unsorted input', () => {
    expect(computeMedianMs([300, 100, 200])).toBe(200);
  });

  it('clamps to integer (rounds .5)', () => {
    expect(computeMedianMs([100, 101])).toBe(101);
  });
});

interface Counts {
  user: number;
  userSuspended: number;
  userKycPending: number;
  userActive7d: number;
  userActive30d: number;
  houseTotal: number;
  housePublished: number;
  houseFlagged: number;
  houseRejected: number;
  leaseActive: number;
  leaseDraft: number;
  ticketOpen: number;
  ticketResolved7d: number;
  ticketSamples: { createdAt: Date; resolvedAt: Date | null }[];
  paidBills: { total: number; currency: string; updatedAt: Date }[];
  overdueBills: { total: number; currency: string }[];
}

function makePrismaStub(c: Counts) {
  const userCount = vi.fn((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    if (w.isSuspended === true) return Promise.resolve(c.userSuspended);
    if (w.kycStatus === 'PENDING') return Promise.resolve(c.userKycPending);
    if (w.lastLoginAt) {
      const since = (w.lastLoginAt as { gte: Date }).gte;
      const ageMs = Date.now() - since.getTime();
      // Tolerate boundary drift in tests — 7d window if since is < 14d ago.
      return Promise.resolve(ageMs < 14 * 24 * 3600_000 ? c.userActive7d : c.userActive30d);
    }
    return Promise.resolve(c.user);
  });
  const houseCount = vi.fn((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    if (w.isPublished === true) return Promise.resolve(c.housePublished);
    if (w.moderationStatus === 'FLAGGED') return Promise.resolve(c.houseFlagged);
    if (w.moderationStatus === 'REJECTED') return Promise.resolve(c.houseRejected);
    return Promise.resolve(c.houseTotal);
  });
  const leaseCount = vi.fn((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    if (w.status === 'ACTIVE') return Promise.resolve(c.leaseActive);
    if (w.status === 'DRAFT') return Promise.resolve(c.leaseDraft);
    return Promise.resolve(0);
  });
  const ticketCount = vi.fn((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    if (w.status && typeof w.status === 'object') return Promise.resolve(c.ticketOpen);
    if (w.resolvedAt) return Promise.resolve(c.ticketResolved7d);
    return Promise.resolve(0);
  });
  const ticketFindMany = vi.fn(() => Promise.resolve(c.ticketSamples));
  const billFindMany = vi.fn((args: { where: Record<string, unknown> }) => {
    const w = args.where;
    if (w.status === 'PAID') {
      const cutoff = (w.updatedAt as { gte?: Date } | undefined)?.gte;
      const filtered = cutoff
        ? c.paidBills.filter((b) => b.updatedAt.getTime() >= cutoff.getTime())
        : c.paidBills;
      return Promise.resolve(filtered.map((b) => ({ total: b.total, currency: b.currency })));
    }
    return Promise.resolve(c.overdueBills);
  });
  const billCount = vi.fn(() => Promise.resolve(c.overdueBills.length));

  return {
    user: { count: userCount },
    house: { count: houseCount },
    lease: { count: leaseCount },
    ticket: { count: ticketCount, findMany: ticketFindMany },
    bill: { count: billCount, findMany: billFindMany },
  };
}

describe('AdminDashboardService', () => {
  let service: AdminDashboardService;

  beforeEach(() => {
    const stub = makePrismaStub({
      user: 12,
      userSuspended: 1,
      userKycPending: 3,
      userActive7d: 4,
      userActive30d: 9,
      houseTotal: 5,
      housePublished: 4,
      houseFlagged: 1,
      houseRejected: 0,
      leaseActive: 3,
      leaseDraft: 2,
      ticketOpen: 2,
      ticketResolved7d: 1,
      ticketSamples: [
        {
          createdAt: new Date(Date.now() - 5 * 3600_000),
          resolvedAt: new Date(Date.now() - 3 * 3600_000),
        },
        {
          createdAt: new Date(Date.now() - 10 * 3600_000),
          resolvedAt: new Date(Date.now() - 4 * 3600_000),
        },
      ],
      paidBills: [
        { total: 500_000, currency: 'VND', updatedAt: new Date(Date.now() - 1 * 86_400_000) },
        { total: 500_000, currency: 'VND', updatedAt: new Date(Date.now() - 100 * 86_400_000) },
        { total: 100, currency: 'USD', updatedAt: new Date(Date.now() - 2 * 86_400_000) },
      ],
      overdueBills: [
        { total: 750_000, currency: 'VND' },
        { total: 250_000, currency: 'VND' },
      ],
    });
    service = new AdminDashboardService(stub as never);
  });

  it('shapes the snapshot from counts + samples', async () => {
    const snap = await service.getSnapshot();

    expect(snap.users).toEqual({
      total: 12,
      suspended: 1,
      pendingKyc: 3,
      activeIn7d: 4,
      activeIn30d: 9,
    });
    expect(snap.houses).toEqual({ total: 5, published: 4, flagged: 1, rejected: 0 });
    expect(snap.leases).toEqual({ active: 3, draft: 2 });
    expect(snap.tickets.openCount).toBe(2);
    expect(snap.tickets.resolvedLast7d).toBe(1);
    // median of (2h, 6h) → 4h
    expect(snap.tickets.medianResolveMs).toBe(4 * 3600_000);
    expect(snap.gmvAllTime).toEqual([
      { currency: 'USD', amount: 100 },
      { currency: 'VND', amount: 1_000_000 },
    ]);
    // gmvLast30d excludes the 100-day-old VND bill
    expect(snap.gmvLast30d).toEqual([
      { currency: 'USD', amount: 100 },
      { currency: 'VND', amount: 500_000 },
    ]);
    expect(snap.overdue).toEqual({
      count: 2,
      byCurrency: [{ currency: 'VND', amount: 1_000_000 }],
    });
    expect(snap.generatedAt).toMatch(/T/);
  });

  it('empty database → all zeros / null median', async () => {
    const stub = makePrismaStub({
      user: 0,
      userSuspended: 0,
      userKycPending: 0,
      userActive7d: 0,
      userActive30d: 0,
      houseTotal: 0,
      housePublished: 0,
      houseFlagged: 0,
      houseRejected: 0,
      leaseActive: 0,
      leaseDraft: 0,
      ticketOpen: 0,
      ticketResolved7d: 0,
      ticketSamples: [],
      paidBills: [],
      overdueBills: [],
    });
    service = new AdminDashboardService(stub as never);
    const snap = await service.getSnapshot();
    expect(snap.users.total).toBe(0);
    expect(snap.tickets.medianResolveMs).toBeNull();
    expect(snap.gmvAllTime).toEqual([]);
    expect(snap.gmvLast30d).toEqual([]);
    expect(snap.overdue).toEqual({ count: 0, byCurrency: [] });
  });
});
