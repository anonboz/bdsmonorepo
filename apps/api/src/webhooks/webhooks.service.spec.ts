import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhooksService } from './webhooks.service.js';
import { stubAnalytics } from '../common/analytics/analytics.test-helper.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { stubNotifications } from '../notifications/notifications.test-helper.js';
import type { StripeService } from '../payments/stripe.service.js';
import type { VnpayService } from '../payments/vnpay.service.js';

function makeVnpayStub(opts: { enabled?: boolean; verify?: boolean } = {}): VnpayService {
  return {
    isEnabled: vi.fn(() => opts.enabled ?? true),
    buildCheckoutUrl: vi.fn(() => 'https://sandbox.vnpayment.vn/...'),
    verifyIpn: vi.fn(() => opts.verify ?? true),
  };
}

/** Stripe event payload shape narrowed to what `handleStripe` reads. */
function stripeEvent(opts: { id?: string; type?: string; sessionId?: string }): {
  id: string;
  type: string;
  data: { object: { id: string } };
} {
  return {
    id: opts.id ?? `evt_${Math.random().toString(36).slice(2, 10)}`,
    type: opts.type ?? 'checkout.session.completed',
    data: { object: { id: opts.sessionId ?? 'cs_test_x' } },
  };
}

function makeStripeStub(opts: {
  enabled?: boolean;
  webhookEnabled?: boolean;
  verify?: () => unknown;
  throwOnVerify?: Error;
}): StripeService {
  const stub: StripeService = {
    isEnabled: vi.fn(() => opts.enabled ?? true),
    isWebhookEnabled: vi.fn(() => opts.webhookEnabled ?? true),
    createCheckoutSession: vi.fn(() => {
      throw new Error('not used in this suite');
    }),
    // The real return type is a 200-member discriminated union; this
    // mock returns the shape the code actually reads (id, type,
    // data.object.id). Cast through the StripeService boundary.
    constructEvent: vi.fn((): ReturnType<StripeService['constructEvent']> => {
      if (opts.throwOnVerify) throw opts.throwOnVerify;
      return (opts.verify ?? (() => stripeEvent({})))() as ReturnType<
        StripeService['constructEvent']
      >;
    }),
    createRefund: vi.fn(() => {
      throw new Error('createRefund not used in this suite');
    }),
  };
  return stub;
}

interface PaymentSeed {
  id: string;
  billId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  provider: 'STRIPE' | 'VNPAY' | 'MOMO' | 'MANUAL';
  providerRef: string | null;
}

interface BillSeed {
  id: string;
  total: number;
  status: 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID' | 'DRAFT';
}

function makePrismaStub(opts: { bills: BillSeed[]; payments: PaymentSeed[] }) {
  const bills = opts.bills.map((b) => ({ ...b }));
  const payments = opts.payments.map((p) => ({ ...p, receivedAt: null as Date | null }));
  const webhookEvents: {
    id: string;
    provider: string;
    eventId: string;
    type: string;
    status: 'RECEIVED' | 'PROCESSED' | 'FAILED';
    error?: string;
    processedAt?: Date;
  }[] = [];
  const auditRows: Record<string, unknown>[] = [];

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    webhookEvent: {
      create: vi.fn(
        ({
          data,
        }: {
          data: { provider: string; eventId: string; type: string; payload: unknown };
        }) => {
          if (
            webhookEvents.some((w) => w.provider === data.provider && w.eventId === data.eventId)
          ) {
            throw new Prisma.PrismaClientKnownRequestError('dup', {
              code: 'P2002',
              clientVersion: 'test',
              meta: { target: ['provider', 'eventId'] },
            });
          }
          const row = {
            id: `wh_${webhookEvents.length + 1}`,
            provider: data.provider,
            eventId: data.eventId,
            type: data.type,
            status: 'RECEIVED' as const,
          };
          webhookEvents.push(row);
          return Promise.resolve(row);
        },
      ),
      updateMany: vi.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          for (const row of webhookEvents) {
            if (
              row.provider === (where.provider as string) &&
              row.eventId === (where.eventId as string)
            ) {
              Object.assign(row, data);
            }
          }
          return Promise.resolve({ count: 1 });
        },
      ),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status?: 'PROCESSED' | 'FAILED'; error?: string; processedAt?: Date };
        }) => {
          const row = webhookEvents.find((w) => w.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return Promise.resolve(row);
        },
      ),
    },
    payment: {
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { provider_providerRef?: { provider: string; providerRef: string } };
        }) => {
          if (where.provider_providerRef) {
            const { provider, providerRef } = where.provider_providerRef;
            const p = payments.find(
              (x) => x.provider === provider && x.providerRef === providerRef,
            );
            return Promise.resolve(p ?? null);
          }
          return Promise.resolve(null);
        },
      ),
      aggregate: vi.fn(({ where }: { where: { billId: string; status: 'SUCCEEDED' } }) => {
        const sum = payments
          .filter((p) => p.billId === where.billId && p.status === where.status)
          .reduce((acc, p) => acc + p.amount, 0);
        return Promise.resolve({ _sum: { amount: sum } });
      }),
      update: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PaymentSeed & { receivedAt: Date }>;
        }) => {
          const p = payments.find((x) => x.id === where.id);
          if (!p) throw new Error('not found');
          Object.assign(p, data);
          return Promise.resolve(p);
        },
      ),
    },
    bill: {
      findUnique: vi.fn(
        ({ where, include }: { where: { id: string }; include?: { lease?: unknown } }) => {
          const b = bills.find((x) => x.id === where.id);
          if (!b) return Promise.resolve(null);
          // The 8.2 webhook handlers ask for `include: { lease: ... }`
          // to grab the tenantId for the bill.paid dispatch. Stub one
          // canonical tenantId; tests don't care which value comes back
          // — `stubNotifications` does not exercise the recipient id.
          return Promise.resolve(include?.lease ? { ...b, lease: { tenantId: 'tenant_1' } } : b);
        },
      ),
      update: vi.fn(
        ({ where, data }: { where: { id: string }; data: { status: BillSeed['status'] } }) => {
          const b = bills.find((x) => x.id === where.id);
          if (!b) throw new Error('not found');
          b.status = data.status;
          return Promise.resolve(b);
        },
      ),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
        return Promise.resolve(auditRows.at(-1));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, bills, payments, webhookEvents, auditRows };
}

describe('WebhooksService.handleStripe', () => {
  let stripe: StripeService;
  let store: ReturnType<typeof makePrismaStub>;
  let service: WebhooksService;

  const baseSeed = {
    bills: [{ id: 'bill_1', total: 500_000, status: 'ISSUED' as const }],
    payments: [
      {
        id: 'pay_1',
        billId: 'bill_1',
        amount: 500_000,
        currency: 'VND',
        status: 'PENDING' as const,
        provider: 'STRIPE' as const,
        providerRef: 'cs_test_x',
      },
    ],
  };

  beforeEach(() => {
    stripe = makeStripeStub({});
    store = makePrismaStub(baseSeed);
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
  });

  it('400 payments.webhook_invalid when signature missing', async () => {
    await expect(service.handleStripe('payload', undefined)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('400 when signature verification throws', async () => {
    stripe = makeStripeStub({ throwOnVerify: new Error('bad signature') });
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(service.handleStripe('payload', 'sig')).rejects.toBeInstanceOf(ProblemError);
  });

  it('checkout.session.completed flips PENDING → SUCCEEDED + Bill → PAID', async () => {
    const evt = stripeEvent({ sessionId: 'cs_test_x' });
    stripe = makeStripeStub({ verify: () => evt });
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleStripe('payload', 'sig');
    expect(res.status).toBe('processed');
    expect(store.payments[0]?.status).toBe('SUCCEEDED');
    expect(store.bills[0]?.status).toBe('PAID');
    expect(store.auditRows.some((r) => r.action === 'bill.payment.confirmed')).toBe(true);
    expect(store.auditRows.some((r) => r.action === 'webhook.received')).toBe(true);
    expect(store.webhookEvents[0]?.status).toBe('PROCESSED');
  });

  it('partial payment leaves Bill at PARTIALLY_PAID', async () => {
    const seed = {
      bills: [{ id: 'bill_1', total: 500_000, status: 'ISSUED' as const }],
      payments: [
        {
          id: 'pay_1',
          billId: 'bill_1',
          amount: 200_000,
          currency: 'VND',
          status: 'PENDING' as const,
          provider: 'STRIPE' as const,
          providerRef: 'cs_test_partial',
        },
      ],
    };
    store = makePrismaStub(seed);
    stripe = makeStripeStub({ verify: () => stripeEvent({ sessionId: 'cs_test_partial' }) });
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await service.handleStripe('payload', 'sig');
    expect(store.bills[0]?.status).toBe('PARTIALLY_PAID');
  });

  it('duplicate event returns "duplicate" without mutating', async () => {
    const evt = stripeEvent({ id: 'evt_dup', sessionId: 'cs_test_x' });
    stripe = makeStripeStub({ verify: () => evt });
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await service.handleStripe('payload', 'sig'); // first
    const beforeStatus = store.payments[0]?.status;
    const res = await service.handleStripe('payload', 'sig'); // dup
    expect(res.status).toBe('duplicate');
    expect(store.payments[0]?.status).toBe(beforeStatus);
    expect(store.webhookEvents).toHaveLength(1);
  });

  it('unknown session id is acked + ignored (no state change)', async () => {
    stripe = makeStripeStub({
      verify: () => stripeEvent({ sessionId: 'cs_unknown_session' }),
    });
    service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleStripe('payload', 'sig');
    expect(res.status).toBe('processed');
    // payment row stays PENDING because the session id doesn't match.
    expect(store.payments[0]?.status).toBe('PENDING');
    expect(store.bills[0]?.status).toBe('ISSUED');
  });

  it('marks WebhookEvent FAILED + rethrows when handler throws', async () => {
    stripe = makeStripeStub({ verify: () => stripeEvent({ sessionId: 'cs_test_x' }) });
    // Sabotage the bill update so the inner tx blows up.
    const sab = makePrismaStub(baseSeed);
    (sab.stub as { bill: { update: typeof vi.fn } }).bill.update = vi.fn(() => {
      throw new Error('db on fire');
    });
    service = new WebhooksService(
      sab.stub as never,
      new AuditLogger(sab.stub as never),
      stripe,
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await expect(service.handleStripe('payload', 'sig')).rejects.toThrow('db on fire');
    expect(sab.webhookEvents[0]?.status).toBe('FAILED');
  });
});

describe('WebhooksService.handleVnpayIpn', () => {
  const baseSeed = {
    bills: [{ id: 'bill_1', total: 500_000, status: 'ISSUED' as const }],
    payments: [
      {
        id: 'pay_v1',
        billId: 'bill_1',
        amount: 500_000,
        currency: 'VND',
        status: 'PENDING' as const,
        provider: 'VNPAY' as const,
        providerRef: 'pay_v1',
      },
    ],
  };

  function ipnQuery(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      vnp_Amount: '50000000', // 500,000 VND * 100
      vnp_TxnRef: 'pay_v1',
      vnp_ResponseCode: '00',
      vnp_TransactionNo: '14242427',
      vnp_SecureHash: 'deadbeef',
      ...overrides,
    };
  }

  it('97 when signature verification fails', async () => {
    const store = makePrismaStub(baseSeed);
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub({ verify: false }),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleVnpayIpn(ipnQuery());
    expect(res).toEqual({ RspCode: '97', Message: 'Invalid Signature' });
  });

  it('00 + flips Payment → SUCCEEDED + Bill → PAID', async () => {
    const store = makePrismaStub(baseSeed);
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleVnpayIpn(ipnQuery());
    expect(res).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(store.payments[0]?.status).toBe('SUCCEEDED');
    expect(store.bills[0]?.status).toBe('PAID');
    expect(store.auditRows.some((r) => r.action === 'bill.payment.confirmed')).toBe(true);
    expect(store.webhookEvents[0]?.status).toBe('PROCESSED');
  });

  it('04 when vnp_Amount disagrees with the Payment row', async () => {
    const store = makePrismaStub(baseSeed);
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleVnpayIpn(ipnQuery({ vnp_Amount: '99999999' }));
    expect(res.RspCode).toBe('04');
    expect(store.payments[0]?.status).toBe('PENDING');
  });

  it('01 when vnp_TxnRef does not match any local Payment', async () => {
    const store = makePrismaStub({ ...baseSeed, payments: [] });
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleVnpayIpn(ipnQuery({ vnp_TxnRef: 'nope' }));
    expect(res.RspCode).toBe('01');
  });

  it('02 when the IPN is a duplicate delivery', async () => {
    const store = makePrismaStub(baseSeed);
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    await service.handleVnpayIpn(ipnQuery()); // first
    const beforeBill = store.bills[0]?.status;
    const res = await service.handleVnpayIpn(ipnQuery()); // dup
    expect(res.RspCode).toBe('02');
    expect(store.bills[0]?.status).toBe(beforeBill);
    expect(store.webhookEvents).toHaveLength(1);
  });

  it('failure response code → 00 ack but Payment marked FAILED', async () => {
    const store = makePrismaStub(baseSeed);
    const service = new WebhooksService(
      store.stub as never,
      new AuditLogger(store.stub as never),
      makeStripeStub({}),
      makeVnpayStub(),
      stubNotifications(),
      stubAnalytics(),
    );
    const res = await service.handleVnpayIpn(ipnQuery({ vnp_ResponseCode: '07' }));
    expect(res.RspCode).toBe('00');
    expect(store.payments[0]?.status).toBe('FAILED');
    expect(store.bills[0]?.status).toBe('ISSUED');
  });
});
