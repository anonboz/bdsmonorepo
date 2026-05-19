import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role } from '@repo/shared';

import { UnitsService } from './units.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

// Minimal Prisma stub: in-memory `house`, `unit`, `lease` tables sufficient
// for the authorization + uniqueness paths exercised here.
function makePrismaStub(opts: { ownerId: string; houseId: string; houseDeleted?: boolean }) {
  const units: Record<string, unknown>[] = [];
  const leases: Record<string, unknown>[] = [];
  const stub = {
    house: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        where.id === opts.houseId
          ? Promise.resolve({
              id: opts.houseId,
              ownerId: opts.ownerId,
              deletedAt: opts.houseDeleted ? new Date() : null,
            })
          : Promise.resolve(null),
      ),
    },
    unit: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        if (units.some((u) => u.houseId === data.houseId && u.label === data.label)) {
          // Throw the real Prisma error class so the service's `instanceof`
          // check matches without mocking the constructor itself.
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.x-test',
            meta: { target: ['houseId', 'label'] },
          });
        }
        const row = {
          id: `unit_${units.length + 1}`,
          ...data,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
        };
        units.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(units.find((u) => u.id === where.id) ?? null),
      ),
      findMany: vi.fn(() => Promise.resolve(units)),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = units.find((u) => u.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(row);
      }),
    },
    lease: {
      count: vi.fn(({ where }: { where: { unitId: string } }) =>
        Promise.resolve(leases.filter((l) => l.unitId === where.unitId).length),
      ),
    },
  };
  return { stub, units, leases };
}

describe('UnitsService', () => {
  const ownerId = 'owner_1';
  const houseId = 'house_1';
  const owner: { id: string; roles: Role[] } = { id: ownerId, roles: ['OWNER'] };
  const otherOwner: { id: string; roles: Role[] } = { id: 'owner_2', roles: ['OWNER'] };
  const admin: { id: string; roles: Role[] } = { id: 'admin_1', roles: ['ADMIN'] };

  let service: UnitsService;
  let prismaStub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prismaStub = makePrismaStub({ ownerId, houseId });
    service = new UnitsService(prismaStub.stub as never);
  });

  const sampleInput = { label: 'A1', status: 'VACANT' as const };

  it('owner creates a unit under their house', async () => {
    const created = await service.create(owner, houseId, sampleInput);
    expect(created.houseId).toBe(houseId);
    expect(created.label).toBe('A1');
    expect(created.status).toBe('VACANT');
  });

  it('non-owning owner sees houses.not_found (no existence leak)', async () => {
    await expect(service.create(otherOwner, houseId, sampleInput)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('admin can read units but not create them', async () => {
    await service.create(owner, houseId, sampleInput);
    const list = await service.list(admin, houseId, { limit: 20, sort: 'desc' });
    expect(list.items).toHaveLength(1);

    await expect(
      service.create(admin, houseId, { ...sampleInput, label: 'A2' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('parent house missing → houses.not_found', async () => {
    await expect(
      service.list(owner, 'wrong_house', { limit: 20, sort: 'desc' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner reads own unit; non-owner does not', async () => {
    const u = await service.create(owner, houseId, sampleInput);
    const fetched = await service.getById(owner, houseId, u.id);
    expect(fetched.id).toBe(u.id);

    await expect(service.getById(otherOwner, houseId, u.id)).rejects.toBeInstanceOf(ProblemError);
  });

  it('soft-delete refuses while active leases exist', async () => {
    const u = await service.create(owner, houseId, sampleInput);
    prismaStub.leases.push({ unitId: u.id, status: 'ACTIVE' });
    await expect(service.softDelete(owner, houseId, u.id)).rejects.toBeInstanceOf(ProblemError);
  });

  it('soft-delete succeeds with no active leases', async () => {
    const u = await service.create(owner, houseId, sampleInput);
    await service.softDelete(owner, houseId, u.id);
    // After soft-delete, getById should 404
    await expect(service.getById(owner, houseId, u.id)).rejects.toBeInstanceOf(ProblemError);
  });
});
