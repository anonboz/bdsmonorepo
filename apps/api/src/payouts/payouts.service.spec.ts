import { describe, expect, it, vi } from 'vitest';

import { PayoutsService } from './payouts.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { stubNotifications } from '../notifications/notifications.test-helper.js';
import type { StripeService } from '../payments/stripe.service.js';

/**
 * Stripe stub used by the legacy non-Connect specs in this file —
 * `isEnabled` is `false`, every method rejects. The new Connect-aware
 * specs at the bottom construct their own per-test stub with shaped
 * return values.
 */
function makeStripeStub(): StripeService {
  return {
    isEnabled: vi.fn(() => false),
    createTransfer: vi.fn(() => Promise.reject(new Error('not stubbed'))),
  } as unknown as StripeService;
}

interface SeedEntry {
  id: string;
  jobId: string;
  kind: 'CHARGE' | 'COMMISSION' | 'PAYOUT';
  status: 'PENDING' | 'HELD' | 'RELEASED' | 'DISBURSED';
  amount: number;
  currency: string;
  accountUserId: string | null;
  cooldownUntil: Date | null;
  releasedAt: Date | null;
  disbursedAt: Date | null;
  disbursementRef: string | null;
  disbursementMethod: 'MANUAL_BANK_TRANSFER' | 'STRIPE_CONNECT' | null;
  disbursedById: string | null;
  createdAt: Date;
}

interface SeedPartner {
  userId: string;
  stripeConnectAccountId: string | null;
  stripeConnectStatus: 'NOT_STARTED' | 'ONBOARDING' | 'ACTIVE' | 'RESTRICTED';
}

function makePrismaStub(
  entries: SeedEntry[],
  users: { id: string; displayName: string; businessName?: string | null }[] = [],
  partners: SeedPartner[] = [],
) {
  const ledger: SeedEntry[] = [...entries];
  const auditRows: Record<string, unknown>[] = [];

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    jobLedgerEntry: {
      findMany: vi.fn(
        ({
          where,
        }: {
          where: Record<string, unknown> & {
            cooldownUntil?: { lt?: Date };
          };
        }) => {
          const filtered = ledger.filter((e) => {
            if (where.kind !== undefined && e.kind !== where.kind) return false;
            if (where.status !== undefined && e.status !== where.status) return false;
            if (where.accountUserId !== undefined && e.accountUserId !== where.accountUserId)
              return false;
            const lt = where.cooldownUntil?.lt;
            if (lt) {
              if (!e.cooldownUntil || e.cooldownUntil.getTime() >= lt.getTime()) return false;
            }
            return true;
          });
          return Promise.resolve(filtered);
        },
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(ledger.find((e) => e.id === where.id) ?? null),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = ledger.find((e) => e.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    partnerProfile: {
      findFirst: vi.fn(({ where }: { where: { userId?: string } }) => {
        const row = partners.find((p) => p.userId === where.userId);
        return Promise.resolve(
          row
            ? {
                id: `pp_${row.userId}`,
                stripeConnectAccountId: row.stripeConnectAccountId,
                stripeConnectStatus: row.stripeConnectStatus,
              }
            : null,
        );
      }),
    },
    user: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) => {
        const ids = new Set(where.id.in);
        return Promise.resolve(
          users
            .filter((u) => ids.has(u.id))
            .map((u) => ({
              id: u.id,
              displayName: u.displayName,
              partnerProfile:
                u.businessName !== undefined ? { businessName: u.businessName } : null,
            })),
        );
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
        return Promise.resolve(auditRows.at(-1));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, ledger, auditRows };
}

function entry(overrides: Partial<SeedEntry> = {}): SeedEntry {
  return {
    id: overrides.id ?? `led_${Math.random().toString(36).slice(2, 8)}`,
    jobId: overrides.jobId ?? 'job_1',
    kind: overrides.kind ?? 'PAYOUT',
    status: overrides.status ?? 'HELD',
    amount: overrides.amount ?? 45_000,
    currency: overrides.currency ?? 'VND',
    accountUserId: overrides.accountUserId ?? 'partner_user_1',
    cooldownUntil: overrides.cooldownUntil ?? null,
    releasedAt: overrides.releasedAt ?? null,
    disbursedAt: overrides.disbursedAt ?? null,
    disbursementRef: overrides.disbursementRef ?? null,
    disbursementMethod: overrides.disbursementMethod ?? null,
    disbursedById: overrides.disbursedById ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

describe('PayoutsService', () => {
  it('listPayoutsForPartner returns own PAYOUT rows', async () => {
    const stub = makePrismaStub([
      entry({ id: 'a', accountUserId: 'partner_user_1', kind: 'PAYOUT' }),
      entry({ id: 'b', accountUserId: 'partner_user_2', kind: 'PAYOUT' }),
      entry({ id: 'c', accountUserId: 'partner_user_1', kind: 'COMMISSION' }),
    ]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    const page = await service.listPayoutsForPartner('partner_user_1', {
      limit: 20,
      sort: 'desc',
    });
    expect(page.items.map((e) => e.id)).toEqual(['a']);
  });

  it('listChargesForOwner returns own CHARGE rows', async () => {
    const stub = makePrismaStub([
      entry({ id: 'x', accountUserId: 'owner_1', kind: 'CHARGE', amount: -50_000 }),
      entry({ id: 'y', accountUserId: 'owner_2', kind: 'CHARGE', amount: -10_000 }),
      entry({ id: 'z', accountUserId: 'owner_1', kind: 'PAYOUT' }),
    ]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    const page = await service.listChargesForOwner('owner_1', { limit: 20, sort: 'desc' });
    expect(page.items.map((e) => e.id)).toEqual(['x']);
  });

  it('releaseEligible flips HELD payouts past cooldown to RELEASED + audits each', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const stub = makePrismaStub([
      entry({ id: 'past', status: 'HELD', cooldownUntil: yesterday }),
      entry({ id: 'future', status: 'HELD', cooldownUntil: tomorrow }),
      entry({ id: 'already', status: 'RELEASED', cooldownUntil: yesterday }),
    ]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    const released = await service.releaseEligible();
    expect(released).toBe(1);

    const past = stub.ledger.find((e) => e.id === 'past')!;
    expect(past.status).toBe('RELEASED');
    expect(past.releasedAt).toBeInstanceOf(Date);

    const future = stub.ledger.find((e) => e.id === 'future')!;
    expect(future.status).toBe('HELD');

    expect(stub.auditRows).toHaveLength(1);
    expect(stub.auditRows[0]).toMatchObject({
      action: 'payout.release',
      actorId: null,
      target: 'JobLedgerEntry:past',
    });
  });

  it('releaseEligible is idempotent — re-running on a RELEASED row is a no-op', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    const stub = makePrismaStub([entry({ id: 'past', status: 'HELD', cooldownUntil: yesterday })]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await service.releaseEligible();
    const audit1 = stub.auditRows.length;
    const released = await service.releaseEligible();
    expect(released).toBe(0);
    expect(stub.auditRows).toHaveLength(audit1);
  });
});

describe('PayoutsService.listAdminPending', () => {
  it('returns only RELEASED PAYOUT rows joined with partner names', async () => {
    const stub = makePrismaStub(
      [
        entry({ id: 'r1', status: 'RELEASED', accountUserId: 'p_a' }),
        entry({ id: 'h1', status: 'HELD', accountUserId: 'p_a' }),
        entry({ id: 'r2', status: 'RELEASED', accountUserId: 'p_b' }),
        entry({ id: 'd1', status: 'DISBURSED', accountUserId: 'p_a' }),
      ],
      [
        { id: 'p_a', displayName: 'Pat', businessName: 'Pat Repairs' },
        { id: 'p_b', displayName: 'Pia', businessName: null },
      ],
    );
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    const page = await service.listAdminPending({ limit: 20, sort: 'asc' });
    expect(page.items.map((p) => p.id).sort()).toEqual(['r1', 'r2']);
    const r1 = page.items.find((p) => p.id === 'r1')!;
    expect(r1.partnerName).toBe('Pat');
    expect(r1.partnerBusinessName).toBe('Pat Repairs');
  });
});

describe('PayoutsService.markDisbursed', () => {
  const ctx = { actorId: 'admin_1', ip: null, userAgent: null };

  it('flips RELEASED → DISBURSED + writes audit', async () => {
    const stub = makePrismaStub([entry({ id: 'r1', status: 'RELEASED', accountUserId: 'p_a' })]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    const res = await service.markDisbursed(
      'r1',
      { method: 'MANUAL_BANK_TRANSFER', reference: 'TXN-001', note: 'first batch' },
      ctx,
    );
    expect(res.status).toBe('DISBURSED');
    expect(res.disbursementRef).toBe('TXN-001');
    expect(res.disbursementMethod).toBe('MANUAL_BANK_TRANSFER');
    expect(res.disbursedById).toBe('admin_1');

    const auditRow = stub.auditRows.find((r) => r.action === 'payout.disburse');
    expect(auditRow).toMatchObject({ actorId: 'admin_1', target: 'JobLedgerEntry:r1' });
  });

  it('404 when the entry does not exist', async () => {
    const stub = makePrismaStub([]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await expect(
      service.markDisbursed('nope', { method: 'MANUAL_BANK_TRANSFER', reference: 'X' }, ctx),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('422 not_disbursable_held when the row is still HELD', async () => {
    const stub = makePrismaStub([entry({ id: 'h1', status: 'HELD' })]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await expect(
      service.markDisbursed('h1', { method: 'MANUAL_BANK_TRANSFER', reference: 'X' }, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('422 already_disbursed when called twice on the same row', async () => {
    const stub = makePrismaStub([entry({ id: 'r1', status: 'RELEASED' })]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await service.markDisbursed(
      'r1',
      { method: 'MANUAL_BANK_TRANSFER', reference: 'TXN-001' },
      ctx,
    );
    await expect(
      service.markDisbursed('r1', { method: 'MANUAL_BANK_TRANSFER', reference: 'TXN-002' }, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('503 payments.provider_disabled when STRIPE_CONNECT picked but Stripe is unconfigured', async () => {
    const stub = makePrismaStub([entry({ id: 'r1', status: 'RELEASED' })]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await expect(
      service.markDisbursed('r1', { method: 'STRIPE_CONNECT', reference: 'X' }, ctx),
    ).rejects.toMatchObject({ status: 503, type: 'payments.provider_disabled' });
  });

  it('422 payouts.partner_not_onboarded when STRIPE_CONNECT but partner not ACTIVE', async () => {
    const stub = makePrismaStub(
      [entry({ id: 'r1', status: 'RELEASED', accountUserId: 'partner_user_1' })],
      [],
      [
        {
          userId: 'partner_user_1',
          stripeConnectAccountId: null,
          stripeConnectStatus: 'NOT_STARTED',
        },
      ],
    );
    const createTransfer = vi.fn();
    const stripe = {
      isEnabled: vi.fn(() => true),
      createTransfer,
    } as unknown as StripeService;
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      stripe,
    );
    await expect(
      service.markDisbursed('r1', { method: 'STRIPE_CONNECT', reference: 'ignored' }, ctx),
    ).rejects.toMatchObject({ status: 422, type: 'payouts.partner_not_onboarded' });
    // No transfer attempt when the partner isn't ACTIVE.
    expect(createTransfer).not.toHaveBeenCalled();
  });

  it('STRIPE_CONNECT happy path issues a transfer and stores the tr_* id as disbursementRef', async () => {
    const stub = makePrismaStub(
      [
        entry({
          id: 'r1',
          status: 'RELEASED',
          accountUserId: 'partner_user_1',
          amount: 45_000,
          currency: 'VND',
        }),
      ],
      [],
      [
        {
          userId: 'partner_user_1',
          stripeConnectAccountId: 'acct_test_123',
          stripeConnectStatus: 'ACTIVE',
        },
      ],
    );
    const createTransfer = vi.fn(() => Promise.resolve({ id: 'tr_test_abc' }));
    const stripe = {
      isEnabled: vi.fn(() => true),
      createTransfer,
    } as unknown as StripeService;
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      stripe,
    );
    const result = await service.markDisbursed(
      'r1',
      // Admin's `reference` is ignored on STRIPE_CONNECT — the
      // transfer id IS the canonical reference.
      { method: 'STRIPE_CONNECT', reference: 'should-be-ignored' },
      ctx,
    );
    expect(result.disbursementMethod).toBe('STRIPE_CONNECT');
    expect(result.disbursementRef).toBe('tr_test_abc');
    expect(createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'acct_test_123',
        amount: 45_000,
        currency: 'VND',
      }),
    );
  });

  it('404 when the entry is a CHARGE row (wrong kind)', async () => {
    const stub = makePrismaStub([
      entry({ id: 'c1', kind: 'CHARGE', status: 'RELEASED', amount: -50_000 }),
    ]);
    const service = new PayoutsService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      stubNotifications(),
      makeStripeStub(),
    );
    await expect(
      service.markDisbursed('c1', { method: 'MANUAL_BANK_TRANSFER', reference: 'X' }, ctx),
    ).rejects.toMatchObject({ status: 404 });
  });
});
