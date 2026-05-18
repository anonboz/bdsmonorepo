import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role } from '@repo/shared';

import { HousesService } from './houses.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

// Minimal Prisma stub that records calls and returns canned rows.
function makePrismaStub() {
  const rows: Record<string, unknown>[] = [];
  const stub = {
    house: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `house_${rows.length + 1}`,
          ...data,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
          _count: { units: 0 },
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(
        ({ where, include }: { where: { id: string }; include?: { units?: unknown } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) return Promise.resolve(null);
          return Promise.resolve(include?.units ? { ...row, units: [] } : row);
        },
      ),
      findMany: vi.fn(() => Promise.resolve(rows)),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve({ ...row, _count: { units: 0 } });
      }),
    },
  };
  return { stub, rows };
}

describe('HousesService', () => {
  let service: HousesService;
  let prismaStub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    prismaStub = makePrismaStub();
    service = new HousesService(prismaStub.stub as never);
  });

  const owner: { id: string; roles: Role[] } = { id: 'owner_1', roles: ['OWNER'] };
  const otherOwner: { id: string; roles: Role[] } = { id: 'owner_2', roles: ['OWNER'] };
  const admin: { id: string; roles: Role[] } = { id: 'admin_1', roles: ['ADMIN'] };

  const sampleInput = {
    name: 'Sunnyside',
    description: 'desc',
    address: {
      line1: '1 Main St',
      city: 'Hanoi',
      country: 'VN' as const,
    },
    isPublished: false,
  };

  it('creates a house owned by the actor', async () => {
    const created = await service.create(owner.id, sampleInput);
    expect(created.ownerId).toBe(owner.id);
    expect(created.address.country).toBe('VN');
    expect(created.unitCount).toBe(0);
  });

  it('owner can read own house', async () => {
    const created = await service.create(owner.id, sampleInput);
    const fetched = await service.getById(owner, created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('owner cannot read another owner’s house (404 to avoid leak)', async () => {
    const created = await service.create(owner.id, sampleInput);
    await expect(service.getById(otherOwner, created.id)).rejects.toBeInstanceOf(ProblemError);
  });

  it('admin can read any house', async () => {
    const created = await service.create(owner.id, sampleInput);
    const fetched = await service.getById(admin, created.id);
    expect(fetched.id).toBe(created.id);
  });

  it('owner cannot mutate another owner’s house', async () => {
    const created = await service.create(owner.id, sampleInput);
    await expect(service.update(otherOwner, created.id, { name: 'evil' })).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('admin cannot mutate (canMutate is owner-only)', async () => {
    const created = await service.create(owner.id, sampleInput);
    await expect(
      service.update(admin, created.id, { name: 'admin-rename' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('soft-delete sets deletedAt', async () => {
    const created = await service.create(owner.id, sampleInput);
    await service.softDelete(owner, created.id);
    // findUnique would return the row but with deletedAt set; getById should now 404
    await expect(service.getById(owner, created.id)).rejects.toBeInstanceOf(ProblemError);
  });
});
