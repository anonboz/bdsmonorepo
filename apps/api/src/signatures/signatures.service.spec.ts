import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeaseStatus, SignatureRole } from '@repo/shared';

import { SignaturesService } from './signatures.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface LeaseRow {
  id: string;
  unitId: string;
  ownerId: string;
  tenantId: string;
  status: LeaseStatus;
  deletedAt: Date | null;
  unit: { houseId: string; deletedAt: Date | null };
}

interface SignatureRow {
  id: string;
  leaseId: string;
  signerId: string;
  role: SignatureRole;
  imageDataUri: string;
  ip: string | null;
  userAgent: string | null;
  signedAt: Date;
}

interface UnitRow {
  id: string;
  status: string;
}

function makeStub(opts: {
  leaseId: string;
  unitId: string;
  houseId: string;
  ownerId: string;
  tenantId: string;
  status: LeaseStatus;
}) {
  const leases: LeaseRow[] = [
    {
      id: opts.leaseId,
      unitId: opts.unitId,
      ownerId: opts.ownerId,
      tenantId: opts.tenantId,
      status: opts.status,
      deletedAt: null,
      unit: { houseId: opts.houseId, deletedAt: null },
    },
  ];
  const units: UnitRow[] = [{ id: opts.unitId, status: 'VACANT' }];
  const signatures: SignatureRow[] = [];
  const audit: Record<string, unknown>[] = [];

  const stub = {
    lease: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(leases.find((l) => l.id === where.id) ?? null),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: { status: LeaseStatus } }) => {
        const l = leases.find((x) => x.id === where.id);
        if (!l) throw new Error('lease not found');
        l.status = data.status;
        return Promise.resolve(l);
      }),
      count: vi.fn(
        ({ where }: { where: { unitId: string; status: LeaseStatus; NOT?: { id: string } } }) =>
          Promise.resolve(
            leases.filter(
              (l) =>
                l.unitId === where.unitId &&
                l.status === where.status &&
                !l.deletedAt &&
                (where.NOT?.id == null || l.id !== where.NOT.id),
            ).length,
          ),
      ),
    },
    unit: {
      update: vi.fn(({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const u = units.find((x) => x.id === where.id);
        if (!u) throw new Error('unit not found');
        u.status = data.status;
        return Promise.resolve(u);
      }),
    },
    signature: {
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { leaseId_role: { leaseId: string; role: SignatureRole } };
          create: Omit<SignatureRow, 'id' | 'signedAt'> & { signedAt?: Date };
          update: Partial<SignatureRow>;
        }) => {
          const existing = signatures.find(
            (s) => s.leaseId === where.leaseId_role.leaseId && s.role === where.leaseId_role.role,
          );
          if (existing) {
            Object.assign(existing, update, { signedAt: new Date() });
            return Promise.resolve(existing);
          }
          const row: SignatureRow = {
            id: `sig_${signatures.length + 1}`,
            signedAt: new Date(),
            ...create,
            ip: create.ip ?? null,
            userAgent: create.userAgent ?? null,
          };
          signatures.push(row);
          return Promise.resolve(row);
        },
      ),
      count: vi.fn(({ where }: { where: { leaseId: string } }) =>
        Promise.resolve(signatures.filter((s) => s.leaseId === where.leaseId).length),
      ),
      findMany: vi.fn(({ where }: { where: { leaseId: string } }) =>
        Promise.resolve(signatures.filter((s) => s.leaseId === where.leaseId)),
      ),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        audit.push({ id: `log_${audit.length + 1}`, ...data });
        return Promise.resolve(audit.at(-1));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  };

  return { stub, leases, units, signatures, audit };
}

const ctx = { actorId: 'caller_1', ip: '127.0.0.1', userAgent: 'curl/test' };
const DATA_URI = `data:image/png;base64,${'A'.repeat(40)}`;

describe('SignaturesService', () => {
  const opts = {
    leaseId: 'lease_1',
    unitId: 'unit_1',
    houseId: 'house_1',
    ownerId: 'owner_1',
    tenantId: 'tenant_1',
    status: 'AWAITING_SIGNATURES' as const,
  };

  let state: ReturnType<typeof makeStub>;
  let service: SignaturesService;

  beforeEach(() => {
    state = makeStub(opts);
    service = new SignaturesService(state.stub as never, new AuditLogger(state.stub as never));
  });

  it('tenant capture inserts a row and audits signature.captured', async () => {
    const sig = await service.createForTenant(
      { id: opts.tenantId },
      opts.leaseId,
      { imageDataUri: DATA_URI },
      ctx,
    );
    expect(sig.role).toBe('TENANT');
    expect(sig.leaseId).toBe(opts.leaseId);
    expect(state.signatures).toHaveLength(1);
    const captured = state.audit.find((r) => r.action === 'signature.captured');
    expect(captured).toBeDefined();
    expect((captured?.meta as Record<string, unknown>).role).toBe('TENANT');
  });

  it("rejects tenant capture when actor isn't the lease tenant", async () => {
    await expect(
      service.createForTenant(
        { id: 'someone_else' },
        opts.leaseId,
        { imageDataUri: DATA_URI },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner capture rejects when house / unit ids do not match', async () => {
    await expect(
      service.createForOwner(
        { id: opts.ownerId },
        'wrong_house',
        opts.unitId,
        opts.leaseId,
        { imageDataUri: DATA_URI },
        ctx,
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('rejects capture when lease is not AWAITING_SIGNATURES', async () => {
    state.leases[0]!.status = 'DRAFT';
    await expect(
      service.createForTenant({ id: opts.tenantId }, opts.leaseId, { imageDataUri: DATA_URI }, ctx),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('auto-activates the lease + flips the unit to OCCUPIED when both sides sign', async () => {
    await service.createForOwner(
      { id: opts.ownerId },
      opts.houseId,
      opts.unitId,
      opts.leaseId,
      { imageDataUri: DATA_URI },
      ctx,
    );
    expect(state.leases[0]!.status).toBe('AWAITING_SIGNATURES');
    expect(state.units[0]!.status).toBe('VACANT');

    await service.createForTenant(
      { id: opts.tenantId },
      opts.leaseId,
      { imageDataUri: DATA_URI },
      ctx,
    );
    expect(state.leases[0]!.status).toBe('ACTIVE');
    expect(state.units[0]!.status).toBe('OCCUPIED');

    const activateRow = state.audit.find((r) => r.action === 'lease.activate');
    expect(activateRow).toBeDefined();
    expect((activateRow?.meta as Record<string, unknown>).via).toBe('signatures');
  });

  it('upsert: re-signing the same role replaces the row in place (no second row)', async () => {
    await service.createForTenant(
      { id: opts.tenantId },
      opts.leaseId,
      { imageDataUri: DATA_URI },
      ctx,
    );
    await service.createForTenant(
      { id: opts.tenantId },
      opts.leaseId,
      { imageDataUri: `${DATA_URI}NEW` },
      ctx,
    );
    expect(state.signatures).toHaveLength(1);
    expect(state.signatures[0]!.imageDataUri).toBe(`${DATA_URI}NEW`);
  });

  it('listForTenant returns the captured signatures', async () => {
    await service.createForTenant(
      { id: opts.tenantId },
      opts.leaseId,
      { imageDataUri: DATA_URI },
      ctx,
    );
    const list = await service.listForTenant({ id: opts.tenantId }, opts.leaseId);
    expect(list).toHaveLength(1);
    expect(list[0]!.role).toBe('TENANT');
  });
});
