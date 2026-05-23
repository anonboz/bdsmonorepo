import { describe, expect, it, vi } from 'vitest';

import { PlatformConfigService } from './platform-config.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';

interface PlatformConfigRow {
  id: string;
  commissionBps: number;
  createdAt: Date;
  updatedAt: Date;
}

function makePrismaStub(initial?: PlatformConfigRow) {
  const rows: PlatformConfigRow[] = initial ? [initial] : [];
  const auditRows: Record<string, unknown>[] = [];
  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    platformConfig: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { id: string };
          create: { id: string; commissionBps: number };
          update: { commissionBps: number };
        }) => {
          const existing = rows.find((r) => r.id === where.id);
          if (existing) {
            existing.commissionBps = update.commissionBps;
            existing.updatedAt = new Date();
            return Promise.resolve(existing);
          }
          const row: PlatformConfigRow = {
            id: create.id,
            commissionBps: create.commissionBps,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          rows.push(row);
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
    $transaction: vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(stub)),
  });
  return { stub, rows, auditRows };
}

const ctx = { actorId: 'admin_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('PlatformConfigService.get', () => {
  it('returns the singleton row when present', async () => {
    const stub = makePrismaStub({
      id: 'singleton',
      commissionBps: 1200,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new PlatformConfigService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
    );
    const config = await service.get();
    expect(config.commissionBps).toBe(1200);
  });

  it('falls back to schema defaults when the row is missing (defensive)', async () => {
    const stub = makePrismaStub();
    const service = new PlatformConfigService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
    );
    const config = await service.get();
    expect(config.commissionBps).toBe(1000);
  });
});

describe('PlatformConfigService.update', () => {
  it('upserts and writes an audit row capturing previous + next bps', async () => {
    const stub = makePrismaStub({
      id: 'singleton',
      commissionBps: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const service = new PlatformConfigService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
    );
    const result = await service.update({ commissionBps: 1200 }, ctx);
    expect(result.commissionBps).toBe(1200);
    expect(stub.rows[0]?.commissionBps).toBe(1200);

    const audit = stub.auditRows[0];
    expect(audit?.action).toBe('platform.config.update');
    expect(audit?.target).toBe('PlatformConfig:singleton');
    expect(audit?.meta).toMatchObject({ previousBps: 1000, nextBps: 1200 });
  });

  it('records previousBps as the schema default when no row existed before', async () => {
    const stub = makePrismaStub();
    const service = new PlatformConfigService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
    );
    await service.update({ commissionBps: 1500 }, ctx);
    expect(stub.auditRows[0]?.meta).toMatchObject({ previousBps: 1000, nextBps: 1500 });
  });
});
