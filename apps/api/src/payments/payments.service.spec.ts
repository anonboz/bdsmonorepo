import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentsService } from './payments.service.js';
import type { StripeService } from './stripe.service.js';
import type { VnpayService } from './vnpay.service.js';
import { stubAnalytics } from '../common/analytics/analytics.test-helper.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { stubNotifications } from '../notifications/notifications.test-helper.js';

/** Mock VnpayService — narrow to the methods PaymentsService calls. */
function makeVnpayStub(opts: { enabled?: boolean } = {}): VnpayService {
  const stub: VnpayService = {
    isEnabled: vi.fn(() => opts.enabled ?? true),
    buildCheckoutUrl: vi.fn(
      () =>
        'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_TxnRef=...&vnp_SecureHash=deadbeef',
    ),
    verifyIpn: vi.fn(() => true),
  };
  return stub;
}

interface StripeStub {
  service: StripeService;
  createCheckoutSession: ReturnType<typeof vi.fn>;
  createRefund: ReturnType<typeof vi.fn>;
}

/** Mock StripeService — narrow to the methods PaymentsService calls. */
function makeStripeStub(
  opts: {
    enabled?: boolean;
    throwOnCreate?: Error;
    nullUrl?: boolean;
    refundThrows?: Error;
  } = {},
): StripeStub {
  const createCheckoutSession = vi.fn((): Promise<{ id: string; url: string | null }> => {
    if (opts.throwOnCreate) return Promise.reject(opts.throwOnCreate);
    const id = `cs_test_${Math.random().toString(36).slice(2, 10)}`;
    const url = opts.nullUrl ? null : `https://checkout.stripe.com/c/pay/${id}`;
    return Promise.resolve({ id, url });
  });
  const createRefund = vi.fn((): Promise<{ id: string; status: string | null }> => {
    if (opts.refundThrows) return Promise.reject(opts.refundThrows);
    return Promise.resolve({
      id: `re_${Math.random().toString(36).slice(2, 8)}`,
      status: 'succeeded',
    });
  });
  const stub: StripeService = {
    isEnabled: vi.fn((): boolean => opts.enabled ?? true),
    isWebhookEnabled: vi.fn((): boolean => false),
    createCheckoutSession,
    // Not exercised by these specs — webhooks have their own suite.
    constructEvent: vi.fn(() => {
      throw new Error('constructEvent not stubbed in this test context');
    }),
    createRefund,
    // Connect surface (Phase 9.1) — not exercised by payments specs;
    // PayoutsService specs cover the disbursement path.
    createConnectAccount: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    createAccountLink: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    retrieveAccount: vi.fn(() => Promise.reject(new Error('not stubbed'))),
    createTransfer: vi.fn(() => Promise.reject(new Error('not stubbed'))),
  };
  return { service: stub, createCheckoutSession, createRefund };
}

interface BillSeed {
  id: string;
  leaseId: string;
  total: number;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID';
}

interface LeaseSeed {
  id: string;
  unitId: string;
  houseId: string;
  ownerId: string;
  tenantId: string;
}

interface PaymentRow {
  id: string;
  billId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  provider: 'STRIPE' | 'VNPAY' | 'MOMO' | 'MANUAL';
  providerRef: string | null;
  providerCaptureRef: string | null;
  note: string | null;
  receivedAt: Date | null;
  failureReason: string | null;
  refundOfPaymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Helper for refund-suite seeds that don't care about every field —
 * fills the structural defaults so callers can spell only what's
 * interesting to the test.
 */
function buildPaymentRow(
  partial: Partial<PaymentRow> &
    Pick<PaymentRow, 'id' | 'billId' | 'amount' | 'currency' | 'provider'>,
): PaymentRow {
  return {
    status: 'SUCCEEDED',
    providerRef: null,
    providerCaptureRef: null,
    note: null,
    receivedAt: null,
    failureReason: null,
    refundOfPaymentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

function makePrismaStub(leases: LeaseSeed[], bills: BillSeed[]) {
  const payments: PaymentRow[] = [];
  const billsState = bills.map((b) => ({ ...b }));
  const auditRows: Record<string, unknown>[] = [];

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    lease: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const l = leases.find((x) => x.id === where.id);
        if (!l) return Promise.resolve(null);
        return Promise.resolve({
          id: l.id,
          unitId: l.unitId,
          ownerId: l.ownerId,
          deletedAt: null,
          unit: { houseId: l.houseId, deletedAt: null },
          // For the tenant-side helper:
          lease: { tenantId: l.tenantId },
        });
      }),
    },
    bill: {
      findUnique: vi.fn(({ where, select }: { where: { id: string }; select?: unknown }) => {
        const b = billsState.find((x) => x.id === where.id);
        if (!b) return Promise.resolve(null);
        if (select) {
          // Tenant-list + Stripe-checkout paths select { lease: { tenantId } }.
          // The checkout path also asks for status / currency / total /
          // periodStart / periodEnd — return everything; Prisma would
          // narrow but the mock is friendlier.
          const lease = leases.find((l) => l.id === b.leaseId);
          return Promise.resolve({
            id: b.id,
            leaseId: b.leaseId,
            status: b.status,
            currency: b.currency,
            total: b.total,
            periodStart: new Date('2026-05-01'),
            periodEnd: new Date('2026-05-31'),
            lease: { tenantId: lease?.tenantId ?? null },
          });
        }
        return Promise.resolve({
          ...b,
          lines: [],
          periodStart: new Date('2026-05-01'),
          periodEnd: new Date('2026-05-31'),
          dueDate: new Date('2026-06-05'),
          issuedAt: new Date('2026-05-01'),
          subtotal: b.total,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }),
      update: vi.fn(
        ({ where, data }: { where: { id: string }; data: { status: BillSeed['status'] } }) => {
          const b = billsState.find((x) => x.id === where.id);
          if (!b) throw new Error('bill not found');
          b.status = data.status;
          return Promise.resolve({
            ...b,
            lines: [],
            periodStart: new Date('2026-05-01'),
            periodEnd: new Date('2026-05-31'),
            dueDate: new Date('2026-06-05'),
            issuedAt: new Date('2026-05-01'),
            subtotal: b.total,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        },
      ),
    },
    payment: {
      aggregate: vi.fn(
        ({
          where,
        }: {
          where: {
            billId?: string;
            status: 'SUCCEEDED';
            refundOfPaymentId?: string;
          };
        }) => {
          const rows = payments.filter((p) => {
            if (p.status !== where.status) return false;
            if (where.billId !== undefined && p.billId !== where.billId) return false;
            if (
              where.refundOfPaymentId !== undefined &&
              p.refundOfPaymentId !== where.refundOfPaymentId
            ) {
              return false;
            }
            return true;
          });
          const sum = rows.reduce((a, r) => a + r.amount, 0);
          return Promise.resolve({ _sum: { amount: sum } });
        },
      ),
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: {
            id?: string;
            provider_providerRef?: { provider: string; providerRef: string };
          };
        }) => {
          if (where.id) {
            return Promise.resolve(payments.find((p) => p.id === where.id) ?? null);
          }
          if (where.provider_providerRef) {
            const { provider, providerRef } = where.provider_providerRef;
            return Promise.resolve(
              payments.find((p) => p.provider === provider && p.providerRef === providerRef) ??
                null,
            );
          }
          return Promise.resolve(null);
        },
      ),
      create: vi.fn(({ data }: { data: Partial<PaymentRow> }) => {
        if (data.providerRef) {
          const dup = payments.some(
            (p) => p.provider === data.provider && p.providerRef === data.providerRef,
          );
          if (dup) {
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: 'test',
              meta: { target: ['provider', 'providerRef'] },
            });
          }
        }
        const row: PaymentRow = {
          id: `pay_${payments.length + 1}`,
          billId: data.billId!,
          amount: data.amount!,
          currency: data.currency!,
          status: data.status ?? 'PENDING',
          provider: data.provider!,
          providerRef: data.providerRef ?? null,
          providerCaptureRef: data.providerCaptureRef ?? null,
          note: data.note ?? null,
          receivedAt: data.receivedAt ?? null,
          failureReason: data.failureReason ?? null,
          refundOfPaymentId: data.refundOfPaymentId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        payments.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where }: { where: { billId: string } }) =>
        Promise.resolve(payments.filter((p) => p.billId === where.billId)),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<PaymentRow> }) => {
        const p = payments.find((x) => x.id === where.id);
        if (!p) throw new Error('payment not found');
        Object.assign(p, data, { updatedAt: new Date() });
        return Promise.resolve(p);
      }),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        const idx = payments.findIndex((x) => x.id === where.id);
        if (idx === -1) throw new Error('payment not found');
        const [removed] = payments.splice(idx, 1);
        return Promise.resolve(removed);
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
        return Promise.resolve(auditRows.at(-1));
      }),
    },
    $queryRaw: vi.fn(() => Promise.resolve([])),
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, payments, bills: billsState, auditRows };
}

describe('PaymentsService.recordManualForOwner', () => {
  const owner = { id: 'user_owner_1', roles: ['OWNER' as const] };
  const leaseId = 'lease_1';
  const billId = 'bill_1';
  const seed = {
    leases: [
      {
        id: leaseId,
        unitId: 'unit_1',
        houseId: 'house_1',
        ownerId: owner.id,
        tenantId: 'user_tenant_1',
      },
    ],
    bills: [
      {
        id: billId,
        leaseId,
        total: 500_000,
        currency: 'VND',
        status: 'ISSUED' as const,
      },
    ],
  };

  const ctx = { actorId: owner.id, ip: null, userAgent: null };

  let store: ReturnType<typeof makePrismaStub>;
  let service: PaymentsService;

  beforeEach(() => {
    store = makePrismaStub(seed.leases, seed.bills);
    service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
  });

  it('records a full payment and flips the bill to PAID', async () => {
    const res = await service.recordManualForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      { amount: 500_000, currency: 'VND', note: 'cash' },
      ctx,
    );
    expect(res.payment.amount).toBe(500_000);
    expect(res.payment.provider).toBe('MANUAL');
    expect(res.bill.status).toBe('PAID');
    expect(store.auditRows[0]).toMatchObject({
      action: 'bill.payment.record',
      target: `Payment:${res.payment.id}`,
    });
  });

  it('flips PARTIALLY_PAID then PAID across two records', async () => {
    const first = await service.recordManualForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      { amount: 200_000, currency: 'VND' },
      ctx,
    );
    expect(first.bill.status).toBe('PARTIALLY_PAID');

    const second = await service.recordManualForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      { amount: 300_000, currency: 'VND' },
      ctx,
    );
    expect(second.bill.status).toBe('PAID');
  });

  it('rejects overpayment with 422', async () => {
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 600_000, currency: 'VND' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects when the bill is already PAID', async () => {
    store = makePrismaStub(seed.leases, [{ ...seed.bills[0]!, status: 'PAID' }]);
    service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 1, currency: 'VND' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects when the bill is DRAFT', async () => {
    store = makePrismaStub(seed.leases, [{ ...seed.bills[0]!, status: 'DRAFT' }]);
    service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 1, currency: 'VND' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects currency mismatch', async () => {
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 1, currency: 'USD' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects receivedAt more than a day in the future', async () => {
    const tooFar = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 1, currency: 'VND', receivedAt: tooFar },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('cross-owner record → 404 existence-hiding', async () => {
    const other = { id: 'user_owner_2', roles: ['OWNER' as const] };
    await expect(
      service.recordManualForOwner(
        other,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 1, currency: 'VND' },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('returns the same 409 on duplicate (provider, providerRef)', async () => {
    await service.recordManualForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      { amount: 100, currency: 'VND', providerRef: 'TXN-123' },
      ctx,
    );
    await expect(
      service.recordManualForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        { amount: 100, currency: 'VND', providerRef: 'TXN-123' },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('PaymentsService.createStripeCheckoutForTenant', () => {
  const owner = { id: 'user_owner_1', roles: ['OWNER' as const] };
  const tenant = { id: 'user_tenant_1', email: 'tenant@example.com' };
  const leaseId = 'lease_1';
  const billId = 'bill_1';
  const ctx = { actorId: tenant.id, ip: null, userAgent: null };

  const seed = {
    leases: [
      {
        id: leaseId,
        unitId: 'unit_1',
        houseId: 'house_1',
        ownerId: owner.id,
        tenantId: tenant.id,
      },
    ],
    bills: [{ id: billId, leaseId, total: 500_000, currency: 'VND', status: 'ISSUED' as const }],
  };

  it('creates a PENDING STRIPE row + returns the session url', async () => {
    const store = makePrismaStub(seed.leases, seed.bills);
    const stripe = makeStripeStub();
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe.service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );

    const res = await service.createStripeCheckoutForTenant(tenant.id, tenant.email, billId, ctx);
    expect(res.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    expect(res.sessionId).toMatch(/^cs_test_/);
    expect(store.payments).toHaveLength(1);
    expect(store.payments[0]).toMatchObject({
      provider: 'STRIPE',
      status: 'PENDING',
      amount: 500_000,
    });
    // Audit row fires after the Stripe round-trip.
    expect(store.auditRows.find((r) => r.action === 'bill.checkout.start')).toBeDefined();
  });

  it('charges only the outstanding balance after a partial MANUAL', async () => {
    const store = makePrismaStub(seed.leases, [{ ...seed.bills[0]!, status: 'PARTIALLY_PAID' }]);
    // Pre-seed one SUCCEEDED MANUAL payment.
    store.payments.push(
      buildPaymentRow({
        id: 'pay_seed',
        billId,
        amount: 200_000,
        currency: 'VND',
        provider: 'MANUAL',
        receivedAt: new Date(),
      }),
    );

    const stripe = makeStripeStub();
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe.service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await service.createStripeCheckoutForTenant(tenant.id, tenant.email, billId, ctx);

    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 300_000 }),
    );
  });

  it('503 payments.provider_disabled when STRIPE_SECRET_KEY is unset', async () => {
    const store = makePrismaStub(seed.leases, seed.bills);
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({ enabled: false }).service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.createStripeCheckoutForTenant(tenant.id, tenant.email, billId, ctx),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('cross-tenant access returns 404', async () => {
    const store = makePrismaStub(seed.leases, seed.bills);
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.createStripeCheckoutForTenant('user_other_tenant', null, billId, ctx),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('422 when the bill is already PAID', async () => {
    const store = makePrismaStub(seed.leases, [{ ...seed.bills[0]!, status: 'PAID' }]);
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.createStripeCheckoutForTenant(tenant.id, tenant.email, billId, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rolls back the local Payment row when Stripe throws', async () => {
    const store = makePrismaStub(seed.leases, seed.bills);
    const stripe = makeStripeStub({ throwOnCreate: new Error('Stripe down') });
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe.service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.createStripeCheckoutForTenant(tenant.id, tenant.email, billId, ctx),
    ).rejects.toThrow('Stripe down');
    expect(store.payments).toHaveLength(0);
  });
});

describe('PaymentsService.refundForOwner', () => {
  const owner = { id: 'user_owner_1', roles: ['OWNER' as const] };
  const leaseId = 'lease_1';
  const billId = 'bill_1';
  const paymentId = 'pay_orig';
  const ctx = { actorId: owner.id, ip: null, userAgent: null };

  function seedFor(provider: 'MANUAL' | 'STRIPE' | 'VNPAY' | 'MOMO' = 'MANUAL') {
    return {
      leases: [
        {
          id: leaseId,
          unitId: 'unit_1',
          houseId: 'house_1',
          ownerId: owner.id,
          tenantId: 'user_tenant_1',
        },
      ],
      bills: [
        {
          id: billId,
          leaseId,
          total: 500_000,
          currency: 'VND',
          status: 'PAID' as const,
        },
      ],
      preExistingPayments: [
        {
          id: paymentId,
          billId,
          amount: 500_000,
          currency: 'VND',
          status: 'SUCCEEDED' as const,
          provider,
          providerRef: 'ref-1',
          providerCaptureRef: provider === 'STRIPE' ? 'pi_test_1' : null,
          refundOfPaymentId: null,
        },
      ],
    };
  }

  it('MANUAL: partial refund flips PAID → PARTIALLY_PAID + writes negative-amount row', async () => {
    const store = makePrismaStub(seedFor('MANUAL').leases, seedFor('MANUAL').bills);
    // Seed the original SUCCEEDED Payment row.
    store.payments.push(buildPaymentRow(seedFor('MANUAL').preExistingPayments[0]!));
    const stripe = makeStripeStub();
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe.service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.refundForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      paymentId,
      { amount: 200_000, reason: 'tenant overpaid' },
      ctx,
    );
    expect(res.payment.amount).toBe(-200_000);
    expect(res.payment.refundOfPaymentId).toBe(paymentId);
    expect(res.bill.status).toBe('PARTIALLY_PAID');
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(store.auditRows.some((r) => r.action === 'bill.payment.refund')).toBe(true);
  });

  it('MANUAL: full refund flips bill back to ISSUED', async () => {
    const store = makePrismaStub(seedFor('MANUAL').leases, seedFor('MANUAL').bills);
    store.payments.push(buildPaymentRow(seedFor('MANUAL').preExistingPayments[0]!));
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.refundForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      paymentId,
      { amount: 500_000 },
      ctx,
    );
    expect(res.bill.status).toBe('ISSUED');
  });

  it('rejects refund exceeding remaining balance', async () => {
    const store = makePrismaStub(seedFor('MANUAL').leases, seedFor('MANUAL').bills);
    store.payments.push(buildPaymentRow(seedFor('MANUAL').preExistingPayments[0]!));
    // Seed an existing partial refund (-200_000).
    store.payments.push(
      buildPaymentRow({
        id: 'pay_ref1',
        billId,
        amount: -200_000,
        currency: 'VND',
        provider: 'MANUAL',
        refundOfPaymentId: paymentId,
      }),
    );
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 400_000 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects refund of a non-SUCCEEDED Payment', async () => {
    const seed = seedFor('MANUAL');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(buildPaymentRow({ ...seed.preExistingPayments[0]!, status: 'PENDING' }));
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 1 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('rejects refunding a refund row', async () => {
    const seed = seedFor('MANUAL');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(buildPaymentRow({ ...seed.preExistingPayments[0]!, amount: -100_000 }));
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 1 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('STRIPE: calls Stripe Refunds API + stores refund id', async () => {
    const seed = seedFor('STRIPE');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(buildPaymentRow(seed.preExistingPayments[0]!));
    const stripe = makeStripeStub();
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe.service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.refundForOwner(
      owner,
      'house_1',
      'unit_1',
      leaseId,
      billId,
      paymentId,
      { amount: 500_000 },
      ctx,
    );
    expect(stripe.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_test_1', amount: 500_000 }),
    );
    expect(res.payment.providerRef).toMatch(/^re_/);
    expect(res.bill.status).toBe('ISSUED');
  });

  it('STRIPE: 422 when providerCaptureRef is missing (legacy payment)', async () => {
    const seed = seedFor('STRIPE');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(
      buildPaymentRow({ ...seed.preExistingPayments[0]!, providerCaptureRef: null }),
    );
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 1 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('VNPAY: 501 payments.refund_not_supported', async () => {
    const seed = seedFor('VNPAY');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(buildPaymentRow(seed.preExistingPayments[0]!));
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        owner,
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 1 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 501 });
  });

  it('cross-owner refund → 404', async () => {
    const seed = seedFor('MANUAL');
    const store = makePrismaStub(seed.leases, seed.bills);
    store.payments.push(buildPaymentRow(seed.preExistingPayments[0]!));
    const service = new PaymentsService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub().service,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(
      service.refundForOwner(
        { id: 'user_other_owner', roles: ['OWNER'] },
        'house_1',
        'unit_1',
        leaseId,
        billId,
        paymentId,
        { amount: 1 },
        ctx,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
