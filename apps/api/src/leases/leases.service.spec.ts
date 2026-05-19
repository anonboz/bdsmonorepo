import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role } from '@repo/shared';

import { LeasesService } from './leases.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

// In-memory stub for the four tables this service touches.
function makePrismaStub(opts: {
  ownerId: string;
  tenantId: string;
  houseId: string;
  unitId: string;
}) {
  const leases: Record<string, unknown>[] = [];
  const units: Record<string, unknown>[] = [
    { id: opts.unitId, houseId: opts.houseId, status: 'VACANT', deletedAt: null },
  ];
  const houses: Record<string, unknown>[] = [
    { id: opts.houseId, ownerId: opts.ownerId, deletedAt: null },
  ];
  const tenant = {
    id: opts.tenantId,
    roles: ['TENANT'],
    deletedAt: null,
    isSuspended: false,
  };

  function getUnitWithHouse(id: string) {
    const u = units.find((x) => x.id === id);
    if (!u) return null;
    const h = houses.find((x) => x.id === u.houseId);
    return { ...u, house: h ? { ownerId: h.ownerId, deletedAt: h.deletedAt, id: h.id } : null };
  }

  function withUnit(row: Record<string, unknown>) {
    const u = units.find((x) => x.id === row.unitId);
    return { ...row, unit: { houseId: u?.houseId } };
  }

  const stub = {
    user: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === tenant.id ? tenant : null),
      ),
    },
    unit: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(getUnitWithHouse(where.id)),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const u = units.find((x) => x.id === where.id);
        if (!u) throw new Error('unit not found');
        Object.assign(u, data);
        return Promise.resolve(u);
      }),
    },
    lease: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `lease_${leases.length + 1}`,
          ...data,
          terminationReason: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
        };
        leases.push(row);
        return Promise.resolve(withUnit(row));
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = leases.find((l) => l.id === where.id);
        return Promise.resolve(row ? withUnit(row) : null);
      }),
      findMany: vi.fn(() => Promise.resolve(leases.map(withUnit))),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = leases.find((l) => l.id === where.id);
        if (!row) throw new Error('lease not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(withUnit(row));
      }),
      count: vi.fn(
        ({ where }: { where: { unitId: string; status: string; NOT?: { id: string } } }) =>
          Promise.resolve(
            leases.filter(
              (l) =>
                l.unitId === where.unitId &&
                l.status === where.status &&
                !l.deletedAt &&
                (where.NOT == null || l.id !== where.NOT.id),
            ).length,
          ),
      ),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  };
  return { stub, leases, units };
}

describe('LeasesService', () => {
  const ownerId = 'owner_1';
  const tenantId = 'tenant_1';
  const houseId = 'house_1';
  const unitId = 'unit_1';
  const owner: { id: string; roles: Role[] } = { id: ownerId, roles: ['OWNER'] };
  const otherOwner: { id: string; roles: Role[] } = { id: 'owner_2', roles: ['OWNER'] };
  const admin: { id: string; roles: Role[] } = { id: 'admin_1', roles: ['ADMIN'] };

  let service: LeasesService;
  let prismaStub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prismaStub = makePrismaStub({ ownerId, tenantId, houseId, unitId });
    service = new LeasesService(prismaStub.stub as never);
  });

  const draftInput = {
    tenantId,
    rentCycle: 'MONTHLY' as const,
    rentAmount: 5_000_00,
    depositAmount: 5_000_00,
    currency: 'VND',
    startDate: '2026-06-01',
  };

  it('owner creates a DRAFT lease', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    expect(lease.status).toBe('DRAFT');
    expect(lease.tenantId).toBe(tenantId);
    expect(lease.rentAmount).toBe(500000);
  });

  it('non-owner sees 404 on create (existence-hiding)', async () => {
    await expect(
      service.createForUnit(otherOwner, houseId, unitId, draftInput),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('DRAFT → ACTIVE flips unit status to OCCUPIED', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    await service.transition(owner, houseId, unitId, lease.id, { to: 'ACTIVE' });
    expect(prismaStub.units[0]?.status).toBe('OCCUPIED');
  });

  it('ACTIVE → ENDED flips unit status back to VACANT', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    await service.transition(owner, houseId, unitId, lease.id, { to: 'ACTIVE' });
    await service.transition(owner, houseId, unitId, lease.id, { to: 'ENDED' });
    expect(prismaStub.units[0]?.status).toBe('VACANT');
  });

  it('activating a second lease while one is active → 409 dates_overlap', async () => {
    const first = await service.createForUnit(owner, houseId, unitId, draftInput);
    await service.transition(owner, houseId, unitId, first.id, { to: 'ACTIVE' });
    const second = await service.createForUnit(owner, houseId, unitId, draftInput);
    await expect(
      service.transition(owner, houseId, unitId, second.id, { to: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('TERMINATED requires a reason — set inline by the transition handler', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    await service.transition(owner, houseId, unitId, lease.id, { to: 'ACTIVE' });
    const terminated = await service.transition(owner, houseId, unitId, lease.id, {
      to: 'TERMINATED',
      terminationReason: 'tenant moved out early',
    });
    expect(terminated.status).toBe('TERMINATED');
    expect(terminated.terminationReason).toBe('tenant moved out early');
  });

  it('rejects transition not allowed by state machine', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    // DRAFT → ENDED is not allowed.
    await expect(
      service.transition(owner, houseId, unitId, lease.id, { to: 'ENDED' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('rejects edit on non-DRAFT lease', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    await service.transition(owner, houseId, unitId, lease.id, { to: 'ACTIVE' });
    await expect(
      service.updateDraft(owner, houseId, unitId, lease.id, { rentAmount: 999 }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('tenant sees only their own leases', async () => {
    const mine = await service.createForUnit(owner, houseId, unitId, draftInput);
    const got = await service.getForTenant(tenantId, mine.id);
    expect(got.id).toBe(mine.id);

    // Different tenant id → 404
    await expect(service.getForTenant('other_tenant', mine.id)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('admin can read any lease', async () => {
    const lease = await service.createForUnit(owner, houseId, unitId, draftInput);
    const got = await service.getAny(lease.id);
    expect(got.id).toBe(lease.id);
  });

  it('admin can list nested under unit (read-only)', async () => {
    await service.createForUnit(owner, houseId, unitId, draftInput);
    const page = await service.listForUnit(admin, houseId, unitId, { limit: 20, sort: 'desc' });
    expect(page.items).toHaveLength(1);
  });
});
