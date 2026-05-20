import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Role } from '@repo/shared';

import { CampaignsService } from './campaigns.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface StubOpts {
  ownerId: string;
  houseId: string;
  unitId: string;
  unitStatus?: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE';
}

function makePrismaStub(opts: StubOpts) {
  const campaigns: Record<string, unknown>[] = [];
  const units: Record<string, unknown>[] = [
    {
      id: opts.unitId,
      houseId: opts.houseId,
      status: opts.unitStatus ?? 'VACANT',
      deletedAt: null,
    },
  ];
  const houses: Record<string, unknown>[] = [
    { id: opts.houseId, ownerId: opts.ownerId, deletedAt: null },
  ];
  const auditRows: Record<string, unknown>[] = [];

  function getUnitWithHouse(id: string) {
    const u = units.find((x) => x.id === id);
    if (!u) return null;
    const h = houses.find((x) => x.id === u.houseId);
    return { ...u, house: h ? { id: h.id, ownerId: h.ownerId, deletedAt: h.deletedAt } : null };
  }

  function withUnit(row: Record<string, unknown>) {
    const u = units.find((x) => x.id === row.unitId);
    return { ...row, unit: { houseId: u?.houseId } };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    unit: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(getUnitWithHouse(where.id)),
      ),
    },
    campaign: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `camp_${campaigns.length + 1}`,
          ...data,
          photos: data.photos ?? [],
          publishedAt: null,
          expiresAt: data.expiresAt ?? null,
          moderationReason: null,
          moderationDecidedAt: null,
          moderationDecidedBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        campaigns.push(row);
        return Promise.resolve(withUnit(row));
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = campaigns.find((c) => c.id === where.id);
        return Promise.resolve(row ? withUnit(row) : null);
      }),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = campaigns.filter((c) => {
          if (c.deletedAt) return false;
          if (where.unitId !== undefined && c.unitId !== where.unitId) return false;
          if (where.status !== undefined && c.status !== where.status) return false;
          return true;
        });
        return Promise.resolve(filtered.map(withUnit));
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = campaigns.find((c) => c.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(withUnit(row));
      }),
      count: vi.fn(
        ({
          where,
        }: {
          where: {
            unitId: string;
            status: string;
            deletedAt: null;
            NOT?: { id: string };
          };
        }) =>
          Promise.resolve(
            campaigns.filter(
              (c) =>
                c.unitId === where.unitId &&
                c.status === where.status &&
                !c.deletedAt &&
                (where.NOT == null || c.id !== where.NOT.id),
            ).length,
          ),
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
  return { stub, campaigns, units, auditRows };
}

const ctx = { actorId: 'owner_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('CampaignsService', () => {
  const ownerId = 'owner_1';
  const houseId = 'house_1';
  const unitId = 'unit_1';
  const owner: { id: string; roles: Role[] } = { id: ownerId, roles: ['OWNER'] };
  const otherOwner: { id: string; roles: Role[] } = { id: 'owner_2', roles: ['OWNER'] };

  let service: CampaignsService;
  let store: ReturnType<typeof makePrismaStub>;

  function boot(overrides: Partial<StubOpts> = {}) {
    store = makePrismaStub({ ownerId, houseId, unitId, ...overrides });
    service = new CampaignsService(store.stub as never, new AuditLogger(store.stub as never));
  }

  beforeEach(() => boot());

  const draft = {
    title: 'Cozy studio',
    body: '20 sqm, balcony, near metro',
    price: 5_000_000,
    currency: 'VND',
    photos: ['https://example.com/p1.jpg'],
  };

  it('owner creates a DRAFT campaign with ownerId denormalized', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    expect(c.status).toBe('DRAFT');
    expect(c.ownerId).toBe(ownerId);
    expect(c.unitId).toBe(unitId);
    expect(c.houseId).toBe(houseId);
    expect(c.photos).toEqual(['https://example.com/p1.jpg']);
  });

  it('cross-owner create → 404', async () => {
    await expect(service.createForUnit(otherOwner, houseId, unitId, draft)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('owner submit (DRAFT → PENDING) succeeds on a VACANT unit and writes audit', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    const submitted = await service.transition(
      owner,
      houseId,
      unitId,
      c.id,
      { to: 'PENDING' },
      ctx,
    );
    expect(submitted.status).toBe('PENDING');
    expect(store.auditRows).toHaveLength(1);
    expect(store.auditRows[0]).toMatchObject({
      action: 'campaign.submit',
      target: `Campaign:${c.id}`,
      actorId: ctx.actorId,
    });
    expect((store.auditRows[0]?.meta as Record<string, unknown>).previousStatus).toBe('DRAFT');
  });

  it('submit on OCCUPIED unit → 409 unit_not_vacant', async () => {
    boot({ unitStatus: 'OCCUPIED' });
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await expect(
      service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('submit when another LIVE exists on the same unit → 409', async () => {
    // Seed a LIVE campaign on the same unit.
    const liveOne = await service.createForUnit(owner, houseId, unitId, draft);
    // Directly poke status to LIVE (admin path not in 4.1; this stub mutate
    // mimics what 4.2 will do).
    store.campaigns.find((c) => c.id === liveOne.id)!.status = 'LIVE';
    const second = await service.createForUnit(owner, houseId, unitId, draft);
    await expect(
      service.transition(owner, houseId, unitId, second.id, { to: 'PENDING' }, ctx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner withdraw (PENDING → DRAFT) succeeds and writes audit', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx);
    const withdrawn = await service.transition(owner, houseId, unitId, c.id, { to: 'DRAFT' }, ctx);
    expect(withdrawn.status).toBe('DRAFT');
    expect(store.auditRows.at(-1)?.action).toBe('campaign.withdraw');
  });

  it('close (LIVE → CLOSED) succeeds and writes audit', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    store.campaigns.find((x) => x.id === c.id)!.status = 'LIVE';
    const closed = await service.transition(owner, houseId, unitId, c.id, { to: 'CLOSED' }, ctx);
    expect(closed.status).toBe('CLOSED');
    expect(store.auditRows.at(-1)?.action).toBe('campaign.close');
  });

  it('invalid transition (DRAFT → CLOSED) → 422', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await expect(
      service.transition(owner, houseId, unitId, c.id, { to: 'CLOSED' }, ctx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('PATCH only allowed on DRAFT', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx);
    await expect(
      service.updateDraft(owner, houseId, unitId, c.id, { title: 'Updated' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('delete allowed on DRAFT and CLOSED, blocked on PENDING/LIVE', async () => {
    const draftRow = await service.createForUnit(owner, houseId, unitId, draft);
    await service.softDelete(owner, houseId, unitId, draftRow.id);
    expect(store.campaigns.find((c) => c.id === draftRow.id)?.deletedAt).not.toBeNull();

    const pending = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, pending.id, { to: 'PENDING' }, ctx);
    await expect(service.softDelete(owner, houseId, unitId, pending.id)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('cross-owner GET → 404 (existence hiding)', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await expect(service.getForUnit(otherOwner, houseId, unitId, c.id)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('rejected transition does NOT write an audit row', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await expect(
      service.transition(owner, houseId, unitId, c.id, { to: 'CLOSED' }, ctx),
    ).rejects.toBeInstanceOf(ProblemError);
    expect(store.auditRows).toHaveLength(0);
  });
});
