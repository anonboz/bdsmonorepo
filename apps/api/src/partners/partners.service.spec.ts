import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PartnersService } from './partners.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface StubOpts {
  partnerUserId: string;
}

function makePrismaStub(opts: StubOpts) {
  const profiles: Record<string, unknown>[] = [];
  const services: Record<string, unknown>[] = [];
  const ratings: Record<string, unknown>[] = [];
  // Backing user table so the profile→user join in PROFILE_WITH_USER works.
  const users: Record<string, unknown>[] = [
    {
      id: opts.partnerUserId,
      displayName: 'Bob the Builder',
      email: 'bob@example.com',
      isSuspended: false,
      deletedAt: null,
    },
  ];

  function withUser(row: Record<string, unknown>) {
    const u = users.find((x) => x.id === row.userId);
    return {
      ...row,
      user: u
        ? {
            displayName: u.displayName,
            email: u.email,
            isSuspended: u.isSuspended,
            deletedAt: u.deletedAt,
          }
        : null,
    };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    partnerProfile: {
      findUnique: vi.fn(({ where }: { where: { id?: string; userId?: string } }) => {
        const row = profiles.find(
          (p) =>
            (where.id != null && p.id === where.id) ||
            (where.userId != null && p.userId === where.userId),
        );
        return Promise.resolve(row ? withUser(row) : null);
      }),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = profiles.filter((p) => {
          if (p.deletedAt) return false;
          const w = where as { user?: { isSuspended?: boolean; deletedAt?: null } };
          if (w.user) {
            const u = users.find((x) => x.id === p.userId);
            if (!u || u.isSuspended || u.deletedAt) return false;
          }
          if (typeof where.OR === 'object') {
            // q filter — match name or area substring (case-insensitive).
            const ors = where.OR as Record<string, { contains?: string }>[];
            const q = ors[0]?.businessName?.contains ?? ors[1]?.serviceArea?.contains;
            if (q) {
              const bn = ((p.businessName as string | undefined) ?? '').toLowerCase();
              const sa = ((p.serviceArea as string | undefined) ?? '').toLowerCase();
              if (!bn.includes(q.toLowerCase()) && !sa.includes(q.toLowerCase())) return false;
            }
          }
          return true;
        });
        return Promise.resolve(filtered.map(withUser));
      }),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = profiles.find((p) => p.userId === where.userId);
          if (existing) {
            Object.assign(existing, update, { updatedAt: new Date() });
            return Promise.resolve(withUser(existing));
          }
          const row = {
            id: `pp_${profiles.length + 1}`,
            ...create,
            kycStatus: 'NONE',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          };
          profiles.push(row);
          return Promise.resolve(withUser(row));
        },
      ),
    },
    jobRating: {
      groupBy: vi.fn(
        ({
          by,
          where,
          _avg,
          _count,
        }: {
          by: string[];
          where: { ratedId?: { in?: string[] } };
          _avg?: { score?: boolean };
          _count?: { score?: boolean };
        }) => {
          // Filter the in-memory ratings table (`ratings` array) to match
          // the where clause, then group by `ratedId` like Prisma does.
          const filter = where.ratedId?.in;
          const filtered = ratings.filter((r) => {
            if (filter && !filter.includes(r.ratedId as string)) return false;
            return true;
          });
          const byRated = new Map<string, number[]>();
          for (const r of filtered) {
            const list = byRated.get(r.ratedId as string) ?? [];
            list.push(r.score as number);
            byRated.set(r.ratedId as string, list);
          }
          const out: {
            ratedId: string;
            _avg: { score: number | null };
            _count: { score: number };
          }[] = [];
          for (const [ratedId, scores] of byRated) {
            const sum = scores.reduce((a, b) => a + b, 0);
            out.push({
              ratedId,
              _avg: { score: _avg?.score ? sum / scores.length : null },
              _count: { score: _count?.score ? scores.length : 0 },
            });
          }
          void by;
          return Promise.resolve(out);
        },
      ),
    },
    service: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(services.find((s) => s.id === where.id) ?? null),
      ),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const w = where as {
          partnerId?: string | { in?: string[] };
          deletedAt?: null;
          isActive?: boolean;
        };
        const ids =
          typeof w.partnerId === 'object' && w.partnerId.in
            ? w.partnerId.in
            : w.partnerId != null
              ? [w.partnerId as string]
              : null;
        const filtered = services.filter((s) => {
          if (s.deletedAt) return false;
          if (ids && !ids.includes(s.partnerId as string)) return false;
          if (w.isActive != null && s.isActive !== w.isActive) return false;
          return true;
        });
        return Promise.resolve(filtered);
      }),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `svc_${services.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        services.push(row);
        return Promise.resolve(row);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const s = services.find((x) => x.id === where.id);
        if (!s) throw new Error('not found');
        Object.assign(s, data, { updatedAt: new Date() });
        return Promise.resolve(s);
      }),
    },
  });
  return { stub, profiles, services, users, ratings };
}

describe('PartnersService', () => {
  const partnerUserId = 'user_partner_1';
  let service: PartnersService;
  let store: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    store = makePrismaStub({ partnerUserId });
    service = new PartnersService(store.stub as never);
  });

  // ---- Partner profile -----------------------------------------------

  it('GET own profile before first PUT → 404', async () => {
    await expect(service.getOwnProfile(partnerUserId)).rejects.toBeInstanceOf(ProblemError);
  });

  it('PUT creates profile on first call', async () => {
    const p = await service.upsertOwnProfile(partnerUserId, {
      businessName: 'Bob Plumbing',
      serviceArea: 'Hanoi',
    });
    expect(p.businessName).toBe('Bob Plumbing');
    expect(p.serviceArea).toBe('Hanoi');
    expect(p.displayName).toBe('Bob the Builder');
    expect(store.profiles).toHaveLength(1);
  });

  it('PUT is idempotent (no duplicates)', async () => {
    await service.upsertOwnProfile(partnerUserId, { businessName: 'V1' });
    const second = await service.upsertOwnProfile(partnerUserId, { businessName: 'V2' });
    expect(second.businessName).toBe('V2');
    expect(store.profiles).toHaveLength(1);
  });

  // ---- Services -----------------------------------------------------

  it('create service without profile → 422 profile_not_found', async () => {
    await expect(
      service.createOwnService(partnerUserId, {
        name: 'Plumbing',
        basePrice: 1_000,
        currency: 'VND',
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('create, list, update, delete service round-trip', async () => {
    await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob Plumbing' });
    const s = await service.createOwnService(partnerUserId, {
      name: 'Plumbing',
      basePrice: 50_000,
      currency: 'VND',
      isActive: true,
    });
    const list1 = await service.listOwnServices(partnerUserId);
    expect(list1.items.map((x) => x.id)).toEqual([s.id]);

    const updated = await service.updateOwnService(partnerUserId, s.id, { basePrice: 60_000 });
    expect(updated.basePrice).toBe(60_000);

    await service.deleteOwnService(partnerUserId, s.id);
    const list2 = await service.listOwnServices(partnerUserId);
    expect(list2.items).toHaveLength(0);
  });

  it('cross-partner service update → 404', async () => {
    await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob' });
    const s = await service.createOwnService(partnerUserId, {
      name: 'X',
      basePrice: 100,
      currency: 'VND',
      isActive: true,
    });
    // Inject another partner with no profile, attempt to update.
    store.users.push({
      id: 'user_partner_2',
      displayName: 'Eve',
      email: null,
      isSuspended: false,
      deletedAt: null,
    });
    await service.upsertOwnProfile('user_partner_2', { businessName: 'Eve' });
    await expect(
      service.updateOwnService('user_partner_2', s.id, { basePrice: 999 }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  // ---- Discovery ----------------------------------------------------

  it('listPublic returns active partners with their active services inlined', async () => {
    await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob Plumbing' });
    await service.createOwnService(partnerUserId, {
      name: 'Plumbing 1h',
      basePrice: 50_000,
      currency: 'VND',
      isActive: true,
    });
    await service.createOwnService(partnerUserId, {
      name: 'Inactive',
      basePrice: 1,
      currency: 'VND',
      isActive: false,
    });

    const page = await service.listPublic({ limit: 20, sort: 'desc' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.activeServices.map((s) => s.name)).toEqual(['Plumbing 1h']);
  });

  it('listPublic hides suspended partners', async () => {
    await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob' });
    store.users[0]!.isSuspended = true;
    const page = await service.listPublic({ limit: 20, sort: 'desc' });
    expect(page.items).toHaveLength(0);
  });

  it('listPublic surfaces rating aggregate + sorts rated partners ahead of unrated', async () => {
    // Two partners — the second one gets two ratings (avg 4.5), the first has none.
    await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob' });
    store.users.push({
      id: 'user_partner_2',
      displayName: 'Eve',
      email: null,
      isSuspended: false,
      deletedAt: null,
    });
    await service.upsertOwnProfile('user_partner_2', { businessName: 'Eve' });

    store.ratings.push(
      { ratedId: 'user_partner_2', score: 4 },
      { ratedId: 'user_partner_2', score: 5 },
    );

    const page = await service.listPublic({ limit: 20, sort: 'desc' });
    expect(page.items.map((p) => p.businessName)).toEqual(['Eve', 'Bob']);
    const eve = page.items[0]!;
    expect(eve.ratingAverage).toBe(4.5);
    expect(eve.ratingCount).toBe(2);
    const bob = page.items[1]!;
    expect(bob.ratingAverage).toBeNull();
    expect(bob.ratingCount).toBe(0);
  });

  it('getPublic returns 404 on suspended / soft-deleted', async () => {
    const p = await service.upsertOwnProfile(partnerUserId, { businessName: 'Bob' });
    const got = await service.getPublic(p.id);
    expect(got.id).toBe(p.id);

    store.users[0]!.isSuspended = true;
    await expect(service.getPublic(p.id)).rejects.toBeInstanceOf(ProblemError);
  });
});
