import { expect, test } from '@playwright/test';

import type { Bill, House, Lease, Page, Unit } from '@repo/shared';

import { loginAs } from '../lib/api.js';

/**
 * Owner builds a house → unit → ACTIVE lease, generates a bill,
 * sees the idempotency short-circuit on retry, and the tenant on
 * `/v1/me/bills` sees the same row.
 *
 * No "pay bill" step — Phase 6 payment providers haven't landed.
 * What we *can* prove today is generation, idempotency, and the
 * tenant read.
 */
test('owner generates a bill end-to-end and the tenant sees it', async () => {
  const owner = await loginAs('owner');
  const tenant = await loginAs('tenant');

  try {
    const house = await owner.post<House>('/v1/houses', {
      name: `E2E House ${Date.now()}`,
      address: { line1: '1 Test Way', city: 'Hanoi', country: 'VN' },
      isPublished: false,
    });

    const unit = await owner.post<Unit>(`/v1/houses/${house.id}/units`, {
      label: 'A1',
      status: 'VACANT',
      bedrooms: 1,
      bathrooms: 1,
      sqm: 40,
    });

    // startDate in the past so the lease's "current period" is
    // unambiguous when generate-now picks a `periodStart`.
    const startDate = isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

    const draftLease = await owner.post<Lease>(`/v1/houses/${house.id}/units/${unit.id}/leases`, {
      tenantId: tenant.userId,
      rentCycle: 'MONTHLY',
      rentAmount: 5_000_00,
      depositAmount: 5_000_00,
      currency: 'VND',
      startDate,
    });
    expect(draftLease.status).toBe('DRAFT');

    const activeLease = await owner.post<Lease>(
      `/v1/houses/${house.id}/units/${unit.id}/leases/${draftLease.id}/transitions`,
      { to: 'ACTIVE' },
    );
    expect(activeLease.status).toBe('ACTIVE');

    const first = await owner.post<{ bill: Bill; status: 'created' | 'idempotent' }>(
      `/v1/houses/${house.id}/units/${unit.id}/leases/${draftLease.id}/bills/generate-now`,
      {},
    );
    expect(first.status).toBe('created');
    expect(first.bill.status).toBe('ISSUED');
    expect(first.bill.total).toBe(5_000_00);
    expect(first.bill.lines.some((l) => l.kind === 'RENT')).toBe(true);

    // Re-firing generate-now for the same period should hit the
    // idempotency short-circuit (no second bill row).
    const second = await owner.post<{ bill: Bill; status: 'created' | 'idempotent' }>(
      `/v1/houses/${house.id}/units/${unit.id}/leases/${draftLease.id}/bills/generate-now`,
      {},
    );
    expect(second.status).toBe('idempotent');
    expect(second.bill.id).toBe(first.bill.id);

    const tenantBills = await tenant.get<Page<Bill>>('/v1/me/bills?limit=50');
    const seen = tenantBills.items.find((b) => b.id === first.bill.id);
    expect(seen, 'tenant should see the bill on /v1/me/bills').toBeDefined();
    expect(seen?.total).toBe(5_000_00);
  } finally {
    await owner.dispose();
    await tenant.dispose();
  }
});

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
