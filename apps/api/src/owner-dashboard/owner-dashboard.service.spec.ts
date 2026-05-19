import { describe, expect, it } from 'vitest';

import { computeMrr, computeOccupancy } from './owner-dashboard.service.js';

describe('computeOccupancy', () => {
  it('all vacant → 0%', () => {
    const o = computeOccupancy([
      { status: 'VACANT' },
      { status: 'VACANT' },
      { status: 'MAINTENANCE' },
    ]);
    expect(o).toEqual({ occupied: 0, total: 3, rate: 0 });
  });

  it('partial → fractional rate (4-decimal rounded)', () => {
    const o = computeOccupancy([
      { status: 'OCCUPIED' },
      { status: 'OCCUPIED' },
      { status: 'VACANT' },
      { status: 'MAINTENANCE' },
    ]);
    expect(o.occupied).toBe(2);
    expect(o.total).toBe(4);
    expect(o.rate).toBe(0.5);
  });

  it('empty → rate 0 (no divide-by-zero)', () => {
    const o = computeOccupancy([]);
    expect(o).toEqual({ occupied: 0, total: 0, rate: 0 });
  });

  it('rounds to four decimal places', () => {
    // 1 of 3 → 0.3333…
    const o = computeOccupancy([
      { status: 'OCCUPIED' },
      { status: 'VACANT' },
      { status: 'VACANT' },
    ]);
    expect(o.rate).toBe(0.3333);
  });
});

describe('computeMrr', () => {
  it('sums MONTHLY rents within currency', () => {
    const mrr = computeMrr([
      { rentCycle: 'MONTHLY', rentAmount: 500_000, currency: 'VND' },
      { rentCycle: 'MONTHLY', rentAmount: 300_000, currency: 'VND' },
    ]);
    expect(mrr).toEqual([{ currency: 'VND', amount: 800_000 }]);
  });

  it('normalizes WEEKLY × 4.333', () => {
    const mrr = computeMrr([{ rentCycle: 'WEEKLY', rentAmount: 100_00, currency: 'USD' }]);
    // 10000 * 4.333 = 43330
    expect(mrr).toEqual([{ currency: 'USD', amount: 43_330 }]);
  });

  it('normalizes QUARTERLY ÷ 3', () => {
    const mrr = computeMrr([{ rentCycle: 'QUARTERLY', rentAmount: 9_000, currency: 'USD' }]);
    expect(mrr).toEqual([{ currency: 'USD', amount: 3_000 }]);
  });

  it('normalizes YEARLY ÷ 12', () => {
    const mrr = computeMrr([{ rentCycle: 'YEARLY', rentAmount: 12_000, currency: 'USD' }]);
    expect(mrr).toEqual([{ currency: 'USD', amount: 1_000 }]);
  });

  it('returns one entry per currency, sorted', () => {
    const mrr = computeMrr([
      { rentCycle: 'MONTHLY', rentAmount: 100, currency: 'USD' },
      { rentCycle: 'MONTHLY', rentAmount: 50_000, currency: 'VND' },
      { rentCycle: 'MONTHLY', rentAmount: 200, currency: 'USD' },
    ]);
    expect(mrr).toEqual([
      { currency: 'USD', amount: 300 },
      { currency: 'VND', amount: 50_000 },
    ]);
  });

  it('empty leases → empty mrr', () => {
    expect(computeMrr([])).toEqual([]);
  });
});
