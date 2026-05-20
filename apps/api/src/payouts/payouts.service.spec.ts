import { describe, expect, it, vi } from 'vitest';

import { PayoutsService } from './payouts.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';

interface SeedEntry {
  id: string;
  jobId: string;
  kind: 'CHARGE' | 'COMMISSION' | 'PAYOUT';
  status: 'PENDING' | 'HELD' | 'RELEASED';
  amount: number;
  currency: string;
  accountUserId: string | null;
  cooldownUntil: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
}

function makePrismaStub(entries: SeedEntry[]) {
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
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = ledger.find((e) => e.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
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
    const service = new PayoutsService(stub.stub as never, new AuditLogger(stub.stub as never));
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
    const service = new PayoutsService(stub.stub as never, new AuditLogger(stub.stub as never));
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
    const service = new PayoutsService(stub.stub as never, new AuditLogger(stub.stub as never));
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
    const service = new PayoutsService(stub.stub as never, new AuditLogger(stub.stub as never));
    await service.releaseEligible();
    const audit1 = stub.auditRows.length;
    const released = await service.releaseEligible();
    expect(released).toBe(0);
    expect(stub.auditRows).toHaveLength(audit1);
  });
});
