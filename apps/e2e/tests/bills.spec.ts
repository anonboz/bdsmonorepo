import { expect, test } from '@playwright/test';

import type { Bill, House, Lease, Page, Payment, RecordPaymentResponse, Unit } from '@repo/shared';

import { loginAs } from '../lib/api.js';

/**
 * Owner builds a house → unit → ACTIVE lease, generates a bill,
 * sees the idempotency short-circuit on retry, the tenant on
 * `/v1/me/bills` sees the same row, then the owner records a
 * MANUAL payment for the full amount → bill flips PAID.
 *
 * Phase 7.1 adds the mark-paid step. Stripe / VNPay end-to-end
 * lands in 7.2 / 7.4.
 */
test('owner generates a bill, records a manual payment, tenant sees PAID', async () => {
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

    // Phase 7.1: owner records a MANUAL payment for the full total.
    const paymentsPath = `/v1/houses/${house.id}/units/${unit.id}/leases/${draftLease.id}/bills/${first.bill.id}/payments`;
    const recorded = await owner.post<RecordPaymentResponse>(paymentsPath, {
      amount: 5_000_00,
      currency: 'VND',
      providerRef: `e2e-${Date.now()}`,
      note: 'cash, paid in full',
    });
    expect(recorded.payment.provider).toBe('MANUAL');
    expect(recorded.payment.amount).toBe(5_000_00);
    expect(recorded.bill.status).toBe('PAID');

    // Owner can list payments.
    const ownerPayments = await owner.get<Page<Payment>>(paymentsPath);
    expect(ownerPayments.items).toHaveLength(1);

    // Tenant sees the payment and the new bill status.
    const tenantPayments = await tenant.get<Page<Payment>>(
      `/v1/me/bills/${first.bill.id}/payments`,
    );
    expect(tenantPayments.items.map((p) => p.id)).toEqual([recorded.payment.id]);

    const tenantBillsAfter = await tenant.get<Page<Bill>>('/v1/me/bills?limit=50');
    const seenAfter = tenantBillsAfter.items.find((b) => b.id === first.bill.id);
    expect(seenAfter?.status).toBe('PAID');

    // Overpaying a PAID bill must 422.
    const overpay = await owner.raw.post(paymentsPath, {
      data: { amount: 1, currency: 'VND' },
    });
    expect(overpay.status()).toBe(422);
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
