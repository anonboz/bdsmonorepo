import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RatingsService } from './ratings.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface LeaseFixture {
  id: string;
  ownerId: string;
  tenantId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'TERMINATED';
  startDate: Date;
  endDate: Date | null;
  unitId: string;
  unit: { houseId: string };
}

function makePrismaStub(lease: LeaseFixture) {
  const ratings: Record<string, unknown>[] = [];
  let nextId = 1;

  const withParties = (row: Record<string, unknown>) => ({
    ...row,
    rater: { displayName: 'Rater' },
    rated: { displayName: 'Rated' },
  });

  const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(where)) {
      if (row[key] !== value) return false;
    }
    return true;
  };

  const stub = {
    lease: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        return Promise.resolve(where.id === lease.id ? { ...lease, deletedAt: null } : null);
      }),
    },
    leaseRating: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const dup = ratings.find(
          (r) =>
            r.leaseId === data.leaseId &&
            r.direction === data.direction &&
            r.milestone === data.milestone,
        );
        if (dup) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
          });
        }
        const row = {
          id: `rating_${nextId++}`,
          ...data,
          comment: data.comment ?? null,
          createdAt: new Date(),
        };
        ratings.push(row);
        return Promise.resolve(withParties(row));
      }),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = ratings.filter((r) => matchesWhere(r, where));
        return Promise.resolve(filtered.map(withParties));
      }),
      aggregate: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = ratings.filter((r) => matchesWhere(r, where));
        const sum = filtered.reduce((acc, r) => acc + (r.score as number), 0);
        return Promise.resolve({
          _avg: { score: filtered.length === 0 ? null : sum / filtered.length },
          _count: { _all: filtered.length },
        });
      }),
    },
  };

  return { stub, ratings };
}

describe('RatingsService', () => {
  const ownerId = 'owner_1';
  const tenantId = 'tenant_1';
  const otherTenantId = 'tenant_other';
  const houseId = 'house_1';
  const unitId = 'unit_1';
  const leaseId = 'lease_1';

  function makeLease(overrides: Partial<LeaseFixture> = {}): LeaseFixture {
    return {
      id: leaseId,
      ownerId,
      tenantId,
      status: 'ACTIVE',
      startDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      endDate: null,
      unitId,
      unit: { houseId },
      ...overrides,
    };
  }

  let service: RatingsService;
  let store: ReturnType<typeof makePrismaStub>;

  function bootWith(lease: LeaseFixture) {
    store = makePrismaStub(lease);
    service = new RatingsService(store.stub as never);
  }

  beforeEach(() => {
    bootWith(makeLease());
  });

  it('tenant submits MOVE_IN once startDate has passed', async () => {
    const r = await service.createForTenant(tenantId, 'Alice', leaseId, {
      milestone: 'MOVE_IN',
      score: 5,
      comment: 'Great place',
    });
    expect(r.score).toBe(5);
    expect(r.direction).toBe('TENANT_TO_OWNER');
    expect(r.ratedId).toBe(ownerId);
  });

  it('non-tenant on the lease → 404', async () => {
    await expect(
      service.createForTenant(otherTenantId, 'Eve', leaseId, { milestone: 'MOVE_IN', score: 4 }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('double-submit on same (lease, direction, milestone) → 409 already_given', async () => {
    await service.createForTenant(tenantId, 'Alice', leaseId, { milestone: 'MOVE_IN', score: 5 });
    await expect(
      service.createForTenant(tenantId, 'Alice', leaseId, { milestone: 'MOVE_IN', score: 3 }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('DRAFT lease → no open milestones', async () => {
    bootWith(makeLease({ status: 'DRAFT' }));
    const state = await service.stateForTenant(tenantId, leaseId);
    expect(state.milestones.every((m) => !m.isOpen)).toBe(true);
    expect(state.milestones.find((m) => m.milestone === 'MOVE_IN')?.reason).toBe('LEASE_DRAFT');
  });

  it('MOVE_OUT before lease ends and no endDate → not open', async () => {
    const state = await service.stateForTenant(tenantId, leaseId);
    const moveOut = state.milestones.find((m) => m.milestone === 'MOVE_OUT');
    expect(moveOut?.isOpen).toBe(false);
    expect(moveOut?.reason).toBe('LEASE_NOT_ENDED');
    await expect(
      service.createForTenant(tenantId, 'Alice', leaseId, { milestone: 'MOVE_OUT', score: 5 }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('MOVE_OUT opens once lease.status flips to ENDED even with null endDate', async () => {
    bootWith(makeLease({ status: 'ENDED' }));
    const r = await service.createForTenant(tenantId, 'Alice', leaseId, {
      milestone: 'MOVE_OUT',
      score: 5,
    });
    expect(r.milestone).toBe('MOVE_OUT');
  });

  it('open-ended lease falls back to startDate + 90d for MID_LEASE', async () => {
    // Backdate startDate by 100 days so MID_LEASE is already open.
    bootWith(
      makeLease({ startDate: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), endDate: null }),
    );
    const state = await service.stateForTenant(tenantId, leaseId);
    expect(state.milestones.find((m) => m.milestone === 'MID_LEASE')?.isOpen).toBe(true);
  });

  it('MID_LEASE picks the midpoint when endDate is sooner than +90d', async () => {
    bootWith(
      makeLease({
        startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      }),
    );
    const state = await service.stateForTenant(tenantId, leaseId);
    // Midpoint = today, so MID_LEASE should be open already.
    expect(state.milestones.find((m) => m.milestone === 'MID_LEASE')?.isOpen).toBe(true);
  });

  it('rating-state marks alreadyRated once submitted', async () => {
    await service.createForTenant(tenantId, 'Alice', leaseId, { milestone: 'MOVE_IN', score: 4 });
    const state = await service.stateForTenant(tenantId, leaseId);
    const moveIn = state.milestones.find((m) => m.milestone === 'MOVE_IN');
    expect(moveIn?.alreadyRated).toBe(true);
    expect(moveIn?.isOpen).toBe(false);
    expect(moveIn?.reason).toBe('ALREADY_RATED');
  });

  it('owner rating against their own lease writes OWNER_TO_TENANT', async () => {
    const r = await service.createForOwner(ownerId, 'Bob', houseId, unitId, leaseId, {
      milestone: 'MOVE_IN',
      score: 4,
    });
    expect(r.direction).toBe('OWNER_TO_TENANT');
    expect(r.ratedId).toBe(tenantId);
  });

  it('owner against the wrong house/unit → 404', async () => {
    await expect(
      service.createForOwner(ownerId, 'Bob', 'house_other', unitId, leaseId, {
        milestone: 'MOVE_IN',
        score: 4,
      }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('summary aggregates only ratings received by the given user', async () => {
    await service.createForTenant(tenantId, 'Alice', leaseId, { milestone: 'MOVE_IN', score: 5 });
    await service.createForOwner(ownerId, 'Bob', houseId, unitId, leaseId, {
      milestone: 'MOVE_IN',
      score: 3,
    });
    const ownerSummary = await service.summaryForUser(ownerId);
    expect(ownerSummary).toEqual({ userId: ownerId, average: 5, count: 1 });
    const tenantSummary = await service.summaryForUser(tenantId);
    expect(tenantSummary).toEqual({ userId: tenantId, average: 3, count: 1 });
  });
});
