import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProblemError } from '../common/errors/problem.error.js';
import { HousesService } from './houses.service.js';

// Minimal Prisma stub that records calls and returns canned rows.
function makePrismaStub() {
  const rows: Array<Record<string, unknown>> = [];
  const stub = {
    house: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `house_${rows.length + 1}`,
          ...data,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
          _count: { units: 0 },
        };
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where, include }: { where: { id: string }; include?: { units?: unknown } }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) return null;
          return include?.units ? { ...row, units: [] } : row;
        },
      ),
      findMany: vi.fn(async () => rows),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row, _count: { units: 0 } };
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

  const owner = { id: 'owner_1', roles: ['OWNER'] as const };
  const otherOwner = { id: 'owner_2', roles: ['OWNER'] as const };
  const admin = { id: 'admin_1', roles: ['ADMIN'] as const };

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
    await expect(
      service.update(otherOwner, created.id, { name: 'evil' }),
    ).rejects.toBeInstanceOf(ProblemError);
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
