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
  houseModerationStatus?: 'OK' | 'FLAGGED' | 'REJECTED';
}

function makePrismaStub(opts: StubOpts) {
  const campaigns: Record<string, unknown>[] = [];
  const units: Record<string, unknown>[] = [
    {
      id: opts.unitId,
      houseId: opts.houseId,
      status: opts.unitStatus ?? 'VACANT',
      deletedAt: null,
      label: 'A1',
      bedrooms: 1,
      bathrooms: 1,
      sqm: 20,
    },
  ];
  const houses: Record<string, unknown>[] = [
    {
      id: opts.houseId,
      ownerId: opts.ownerId,
      deletedAt: null,
      name: 'Test House',
      city: 'Hanoi',
      country: 'VN',
      moderationStatus: opts.houseModerationStatus ?? 'OK',
    },
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
    const h = houses.find((x) => x.id === u?.houseId);
    return {
      ...row,
      unit: {
        houseId: u?.houseId,
        label: u?.label,
        bedrooms: u?.bedrooms,
        bathrooms: u?.bathrooms,
        sqm: u?.sqm,
        ...(h && {
          house: {
            name: h.name,
            city: h.city,
            country: h.country,
            moderationStatus: h.moderationStatus,
          },
        }),
      },
    };
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
        const orClauses = where.OR as Record<string, unknown>[] | undefined;
        const unitWhere = where.unit as { house?: { moderationStatus?: unknown } } | undefined;
        const expiresAt = where.expiresAt as { lt?: Date; gt?: Date; not?: unknown } | undefined;
        const filtered = campaigns.filter((c) => {
          if (c.deletedAt) return false;
          if (where.unitId !== undefined && c.unitId !== where.unitId) return false;
          if (where.ownerId !== undefined && c.ownerId !== where.ownerId) return false;
          if (where.status !== undefined && c.status !== where.status) return false;
          // Public visibility OR clause: expiresAt null OR expiresAt > now.
          if (orClauses && orClauses.length > 0) {
            const ok = orClauses.some((clause) => {
              const ea = clause.expiresAt as { gt?: Date } | null | undefined;
              if (ea === null) return c.expiresAt == null;
              const gt = ea?.gt;
              if (gt) {
                return c.expiresAt != null && (c.expiresAt as Date).getTime() > gt.getTime();
              }
              return false;
            });
            if (!ok) return false;
          }
          // expireOverdue: expiresAt < now.
          if (expiresAt?.lt) {
            if (c.expiresAt == null) return false;
            if ((c.expiresAt as Date).getTime() >= expiresAt.lt.getTime()) return false;
          }
          // Public REJECTED-house hide. Resolve house via unit.
          if (unitWhere?.house?.moderationStatus) {
            const u = units.find((x) => x.id === c.unitId);
            const h = houses.find((x) => x.id === u?.houseId);
            const ms = (unitWhere.house.moderationStatus as { not?: string }).not;
            if (ms && h?.moderationStatus === ms) return false;
          }
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
  return { stub, campaigns, units, houses, auditRows };
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

  it('PATCH allowed on DRAFT but not on PENDING / LIVE / CLOSED / EXPIRED', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx);
    await expect(
      service.updateDraft(owner, houseId, unitId, c.id, { title: 'Updated' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('PATCH also allowed on REJECTED (re-submit recovery)', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    store.campaigns.find((x) => x.id === c.id)!.status = 'REJECTED';
    const updated = await service.updateDraft(owner, houseId, unitId, c.id, {
      title: 'Fixed photos',
    });
    expect(updated.title).toBe('Fixed photos');
    expect(updated.status).toBe('REJECTED');
  });

  it('owner re-submit (REJECTED → PENDING) succeeds and clears moderation snapshot', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    // Stage a prior rejection.
    const row = store.campaigns.find((x) => x.id === c.id)!;
    row.status = 'REJECTED';
    row.moderationReason = 'no photos';
    row.moderationDecidedAt = new Date();
    row.moderationDecidedBy = 'admin_1';

    const resubmitted = await service.transition(
      owner,
      houseId,
      unitId,
      c.id,
      { to: 'PENDING' },
      ctx,
    );
    expect(resubmitted.status).toBe('PENDING');
    expect(resubmitted.moderationReason).toBeNull();
    expect(resubmitted.moderationDecidedAt).toBeNull();
    expect(resubmitted.moderationDecidedBy).toBeNull();
    const submitRow = store.auditRows.at(-1);
    expect(submitRow?.action).toBe('campaign.submit');
    expect((submitRow?.meta as Record<string, unknown>).previousStatus).toBe('REJECTED');
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

  // ---- Admin moderation (4.2) -----------------------------------------

  const adminCtx = { actorId: 'admin_1', ip: '10.0.0.1', userAgent: 'admin-ui/1.0' };

  it('admin approves a PENDING campaign — flips LIVE, sets publishedAt, audits', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx);

    const approved = await service.approveAsAdmin(c.id, adminCtx);
    expect(approved.status).toBe('LIVE');
    expect(approved.publishedAt).not.toBeNull();
    expect(approved.moderationDecidedBy).toBe(adminCtx.actorId);
    expect(store.auditRows.at(-1)?.action).toBe('campaign.approve');
  });

  it('admin rejects a PENDING campaign — stores reason + audits', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, c.id, { to: 'PENDING' }, ctx);

    const rejected = await service.rejectAsAdmin(c.id, { reason: 'no photos' }, adminCtx);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.moderationReason).toBe('no photos');
    expect(rejected.moderationDecidedBy).toBe(adminCtx.actorId);
    const last = store.auditRows.at(-1);
    expect(last?.action).toBe('campaign.reject');
    expect((last?.meta as Record<string, unknown>).reason).toBe('no photos');
  });

  it('approve / reject on a non-PENDING campaign → 422 admin.campaign_not_pending', async () => {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    // Still DRAFT.
    await expect(service.approveAsAdmin(c.id, adminCtx)).rejects.toBeInstanceOf(ProblemError);
    await expect(service.rejectAsAdmin(c.id, { reason: 'x' }, adminCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('admin list filters by status and ownerId', async () => {
    const a = await service.createForUnit(owner, houseId, unitId, draft);
    await service.transition(owner, houseId, unitId, a.id, { to: 'PENDING' }, ctx);
    const b = await service.createForUnit(owner, houseId, unitId, draft);
    // b stays DRAFT — exercises status filter.

    const onlyPending = await service.listAsAdmin({ limit: 20, sort: 'desc', status: 'PENDING' });
    expect(onlyPending.items.map((x) => x.id)).toEqual([a.id]);

    const wrongOwner = await service.listAsAdmin({
      limit: 20,
      sort: 'desc',
      ownerId: 'someone_else',
    });
    expect(wrongOwner.items).toHaveLength(0);

    const all = await service.listAsAdmin({ limit: 20, sort: 'desc' });
    expect(all.items.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
  });

  // ---- Public read (4.3) ----------------------------------------------

  // Plant a LIVE campaign directly via the stub so multiple co-exist on
  // one unit. The submit guard rejects two LIVE on a single unit at
  // service level (correctly), but for read-side fixtures the direct
  // poke is the simplest path.
  async function plantLive(opts: { expiresAt?: Date | null } = {}) {
    const c = await service.createForUnit(owner, houseId, unitId, draft);
    const row = store.campaigns.find((x) => x.id === c.id)!;
    row.status = 'LIVE';
    row.publishedAt = new Date();
    if (opts.expiresAt !== undefined) row.expiresAt = opts.expiresAt;
    return c.id;
  }

  it('listPublic returns only LIVE non-expired non-REJECTED-house campaigns', async () => {
    const live = await plantLive();
    // Add a DRAFT (not visible)
    await service.createForUnit(owner, houseId, unitId, draft);
    const page = await service.listPublic({ limit: 50, sort: 'desc' });
    expect(page.items.map((x) => x.id)).toEqual([live]);
  });

  it('listPublic hides expired campaigns', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000);
    await plantLive({ expiresAt: yesterday });
    const page = await service.listPublic({ limit: 50, sort: 'desc' });
    expect(page.items).toHaveLength(0);
  });

  it('listPublic hides campaigns whose house is REJECTED', async () => {
    await plantLive();
    store.houses[0]!.moderationStatus = 'REJECTED';
    const page = await service.listPublic({ limit: 50, sort: 'desc' });
    expect(page.items).toHaveLength(0);
  });

  it('getPublic returns 404 on non-LIVE / expired / REJECTED-house', async () => {
    const live = await plantLive();
    const got = await service.getPublic(live);
    expect(got.id).toBe(live);
    expect(got.house.city).toBe('Hanoi');

    // Expired
    store.campaigns.find((x) => x.id === live)!.expiresAt = new Date(Date.now() - 1000);
    await expect(service.getPublic(live)).rejects.toBeInstanceOf(ProblemError);

    // Restore + flip house to REJECTED
    store.campaigns.find((x) => x.id === live)!.expiresAt = null;
    store.houses[0]!.moderationStatus = 'REJECTED';
    await expect(service.getPublic(live)).rejects.toBeInstanceOf(ProblemError);
  });

  it('expireOverdue flips eligible LIVE rows to EXPIRED and audits each', async () => {
    const expired = await plantLive({ expiresAt: new Date(Date.now() - 24 * 3600_000) });
    const fresh = await plantLive({ expiresAt: new Date(Date.now() + 24 * 3600_000) });

    const before = store.auditRows.length;
    const count = await service.expireOverdue();
    expect(count).toBe(1);
    expect(store.campaigns.find((x) => x.id === expired)?.status).toBe('EXPIRED');
    expect(store.campaigns.find((x) => x.id === fresh)?.status).toBe('LIVE');

    const expireRow = store.auditRows.slice(before).find((r) => r.action === 'campaign.expire');
    expect(expireRow).toBeDefined();
    expect(expireRow?.actorId).toBeNull();
    expect((expireRow?.meta as Record<string, unknown>).source).toBe('sweeper');
    expect((expireRow?.meta as Record<string, unknown>).previousStatus).toBe('LIVE');
  });
});
