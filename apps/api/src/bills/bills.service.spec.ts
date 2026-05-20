import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BillsService,
  buildIdempotencyKey,
  currentPeriodStart,
  periodEndFor,
} from './bills.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

function makePrismaStub(opts: {
  leaseId: string;
  tenantId: string;
  rentAmount?: number;
  status?: 'ACTIVE' | 'DRAFT' | 'ENDED';
  rentCycle?: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
}) {
  const bills: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    lease: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        where.id === opts.leaseId
          ? Promise.resolve({
              id: opts.leaseId,
              tenantId: opts.tenantId,
              status: opts.status ?? 'ACTIVE',
              rentCycle: opts.rentCycle ?? 'MONTHLY',
              rentAmount: opts.rentAmount ?? 500_000,
              currency: 'VND',
              deletedAt: null,
            })
          : Promise.resolve(null),
      ),
      findMany: vi.fn(() => Promise.resolve([])),
    },
    bill: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        // Treat (leaseId, idempotencyKey) as unique.
        const dupe = bills.some(
          (b) => b.leaseId === data.leaseId && b.idempotencyKey === data.idempotencyKey,
        );
        if (dupe) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.x-test',
            meta: { target: ['leaseId', 'idempotencyKey'] },
          });
        }
        const row = {
          id: `bill_${bills.length + 1}`,
          ...data,
          // Materialize the nested `lines.create` into a lines array so the
          // service's response mapper has something to project.
          lines: ((data.lines as { create: Record<string, unknown>[] }).create ?? []).map(
            (l, i) => ({
              id: `line_${bills.length + 1}_${i + 1}`,
              billId: `bill_${bills.length + 1}`,
              ...l,
              createdAt: new Date(),
            }),
          ),
          issuedAt: data.issuedAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        bills.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { leaseId_idempotencyKey?: { leaseId: string; idempotencyKey: string } };
        }) => {
          if (!where.leaseId_idempotencyKey) return Promise.resolve(null);
          const { leaseId, idempotencyKey } = where.leaseId_idempotencyKey;
          const row =
            bills.find((b) => b.leaseId === leaseId && b.idempotencyKey === idempotencyKey) ?? null;
          return Promise.resolve(row);
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
  return { stub, bills, auditRows };
}

describe('BillsService.generateForLease', () => {
  let service: BillsService;
  let prismaStub: ReturnType<typeof makePrismaStub>;
  const leaseId = 'lease_1';

  beforeEach(() => {
    prismaStub = makePrismaStub({ leaseId, tenantId: 'tenant_1' });
    service = new BillsService(prismaStub.stub as never, new AuditLogger(prismaStub.stub as never));
  });

  it('creates a bill with one RENT line at the lease amount', async () => {
    const result = await service.generateForLease(leaseId, { periodStart: '2026-06-01' });
    expect(result.status).toBe('created');
    expect(result.bill.lines).toHaveLength(1);
    expect(result.bill.lines[0]?.kind).toBe('RENT');
    expect(result.bill.lines[0]?.amount).toBe(500_000);
    expect(result.bill.total).toBe(500_000);
    expect(result.bill.status).toBe('ISSUED');
  });

  it('is idempotent — second call for the same lease+period returns the same bill', async () => {
    const first = await service.generateForLease(leaseId, { periodStart: '2026-06-01' });
    const second = await service.generateForLease(leaseId, { periodStart: '2026-06-01' });
    expect(first.status).toBe('created');
    expect(second.status).toBe('idempotent');
    expect(second.bill.id).toBe(first.bill.id);
    expect(prismaStub.bills).toHaveLength(1);
  });

  it('rejects on non-ACTIVE lease', async () => {
    prismaStub = makePrismaStub({ leaseId, tenantId: 'tenant_1', status: 'DRAFT' });
    service = new BillsService(prismaStub.stub as never, new AuditLogger(prismaStub.stub as never));
    await expect(service.generateForLease(leaseId)).rejects.toBeInstanceOf(ProblemError);
  });

  it('rejects on missing lease', async () => {
    await expect(service.generateForLease('nope')).rejects.toBeInstanceOf(ProblemError);
  });

  it('writes a bill.generate audit row with the supplied source + actor', async () => {
    await service.generateForLease(
      leaseId,
      { periodStart: '2026-06-01' },
      { actorId: 'owner_1', source: 'owner', ip: '127.0.0.1', userAgent: 'curl/test' },
    );
    expect(prismaStub.auditRows).toHaveLength(1);
    expect(prismaStub.auditRows[0]).toMatchObject({
      action: 'bill.generate',
      actorId: 'owner_1',
    });
    const meta = prismaStub.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.source).toBe('owner');
    expect(meta.leaseId).toBe(leaseId);
    expect(meta.idempotencyKey).toBe('MONTHLY:2026-06-01');
    expect(meta.periodStart).toBe('2026-06-01');
  });

  it('default ctx (worker call) writes source=sweeper with null actor', async () => {
    await service.generateForLease(leaseId, { periodStart: '2026-07-01' });
    const meta = prismaStub.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.source).toBe('sweeper');
    expect(prismaStub.auditRows[0]?.actorId).toBeNull();
  });

  it('idempotent second call does NOT write a second audit row', async () => {
    await service.generateForLease(leaseId, { periodStart: '2026-06-01' });
    await service.generateForLease(leaseId, { periodStart: '2026-06-01' });
    expect(prismaStub.auditRows).toHaveLength(1);
  });
});

describe('Period math', () => {
  it('MONTHLY starts on the first of the month', () => {
    const start = currentPeriodStart('MONTHLY', new Date('2026-06-15T12:00:00Z'));
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('MONTHLY ends on the last day of the month', () => {
    const start = new Date('2026-02-01T00:00:00Z');
    const end = periodEndFor(start, 'MONTHLY');
    expect(end.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('WEEKLY anchors to Monday', () => {
    // 2026-06-15 is a Monday — pick a Wednesday to verify
    const start = currentPeriodStart('WEEKLY', new Date('2026-06-17T12:00:00Z'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-06-15');
  });

  it('YEARLY starts Jan 1', () => {
    const start = currentPeriodStart('YEARLY', new Date('2026-06-15T12:00:00Z'));
    expect(start.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('idempotency key is stable per cycle+date', () => {
    const k = buildIdempotencyKey('MONTHLY', new Date('2026-06-01T00:00:00Z'));
    expect(k).toBe('MONTHLY:2026-06-01');
  });
});
