import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationsService } from './applications.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface StubOpts {
  campaignId: string;
  ownerId: string;
  unitId: string;
  houseId: string;
  campaignStatus?: 'DRAFT' | 'PENDING' | 'LIVE' | 'CLOSED' | 'REJECTED' | 'EXPIRED';
  unitStatus?: 'VACANT' | 'OCCUPIED' | 'MAINTENANCE';
}

function makePrismaStub(opts: StubOpts) {
  const applications: Record<string, unknown>[] = [];
  const leases: Record<string, unknown>[] = [];
  const campaigns: Record<string, unknown>[] = [
    {
      id: opts.campaignId,
      ownerId: opts.ownerId,
      status: opts.campaignStatus ?? 'LIVE',
      unitId: opts.unitId,
      currency: 'VND',
      price: 5_000_000,
      deletedAt: null,
    },
  ];
  const units: Record<string, unknown>[] = [
    {
      id: opts.unitId,
      houseId: opts.houseId,
      status: opts.unitStatus ?? 'VACANT',
      deletedAt: null,
    },
  ];
  const auditRows: Record<string, unknown>[] = [];

  function getCampaign(id: string) {
    const c = campaigns.find((x) => x.id === id);
    if (!c) return null;
    const u = units.find((x) => x.id === c.unitId);
    return { ...c, unit: u ? { houseId: u.houseId, status: u.status } : null };
  }

  function withApplicant(row: Record<string, unknown>) {
    return { ...row, applicant: { displayName: `User-${row.applicantId as string}` } };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    campaign: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(getCampaign(where.id)),
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const c = campaigns.find((x) => x.id === where.id);
        if (!c) throw new Error('not found');
        Object.assign(c, data);
        return Promise.resolve(c);
      }),
    },
    application: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const dup = applications.find(
          (a) => a.campaignId === data.campaignId && a.applicantId === data.applicantId,
        );
        if (dup) {
          throw new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: ['campaignId', 'applicantId'] },
          });
        }
        const row = {
          id: `app_${applications.length + 1}`,
          ...data,
          message: data.message ?? null,
          rejectionReason: null,
          decidedAt: null,
          decidedBy: null,
          createdLeaseId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        applications.push(row);
        return Promise.resolve(withApplicant(row));
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = applications.find((a) => a.id === where.id);
        return Promise.resolve(row ? withApplicant(row) : null);
      }),
      findMany: vi.fn(
        ({
          where,
        }: {
          where: Record<string, unknown> & {
            id?: { not?: string };
            status?: string | { in?: string[] };
          };
        }) => {
          const filtered = applications.filter((a) => {
            if (where.applicantId !== undefined && a.applicantId !== where.applicantId)
              return false;
            if (where.campaignId !== undefined && a.campaignId !== where.campaignId) return false;
            if (where.id?.not !== undefined && a.id === where.id.not) return false;
            if (where.status !== undefined) {
              if (typeof where.status === 'string' && a.status !== where.status) return false;
              if (typeof where.status === 'object' && where.status.in) {
                if (!where.status.in.includes(a.status as string)) return false;
              }
            }
            return true;
          });
          return Promise.resolve(filtered.map(withApplicant));
        },
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = applications.find((a) => a.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(withApplicant(row));
      }),
      count: vi.fn(({ where }: { where: { applicantId: string; createdAt?: { gte: Date } } }) =>
        Promise.resolve(
          applications.filter(
            (a) =>
              a.applicantId === where.applicantId &&
              (where.createdAt?.gte == null ||
                (a.createdAt as Date).getTime() >= where.createdAt.gte.getTime()),
          ).length,
        ),
      ),
    },
    lease: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `lease_${leases.length + 1}`,
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        leases.push(row);
        return Promise.resolve(row);
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
        return Promise.resolve(auditRows.at(-1));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, applications, leases, campaigns, units, auditRows };
}

const tenantCtx = { actorId: 'tenant_1', ip: '127.0.0.1', userAgent: 'curl/test' };
const ownerCtx = { actorId: 'owner_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('ApplicationsService', () => {
  const campaignId = 'camp_1';
  const ownerId = 'owner_1';
  const tenantId = 'tenant_1';
  const otherTenantId = 'tenant_2';
  const unitId = 'unit_1';
  const houseId = 'house_1';

  let service: ApplicationsService;
  let store: ReturnType<typeof makePrismaStub>;

  function boot(overrides: Partial<StubOpts> = {}) {
    store = makePrismaStub({ campaignId, ownerId, unitId, houseId, ...overrides });
    service = new ApplicationsService(store.stub as never, new AuditLogger(store.stub as never));
  }

  beforeEach(() => boot());

  // ---- Tenant submit ------------------------------------------------

  it('tenant applies to a LIVE campaign → SUBMITTED + audit', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    expect(a.status).toBe('SUBMITTED');
    expect(a.applicantId).toBe(tenantId);
    expect(a.ownerId).toBe(ownerId);
    const submit = store.auditRows.find((r) => r.action === 'application.submit');
    expect(submit).toBeDefined();
  });

  it('apply to a non-LIVE campaign → 422 campaign_not_live', async () => {
    boot({ campaignStatus: 'DRAFT' });
    await expect(
      service.createForTenant(tenantId, { campaignId }, tenantCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner applying to own campaign → 422 applications.self', async () => {
    await expect(
      service.createForTenant(ownerId, { campaignId }, { ...tenantCtx, actorId: ownerId }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('duplicate apply → 409 duplicate', async () => {
    await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    await expect(
      service.createForTenant(tenantId, { campaignId }, tenantCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('rate limit: 6th application in 24h → 429', async () => {
    // Seed 5 applications by hand for tenantId.
    for (let i = 0; i < 5; i++) {
      store.applications.push({
        id: `seed_${i}`,
        campaignId: `other_${i}`,
        applicantId: tenantId,
        ownerId,
        status: 'SUBMITTED',
        message: null,
        rejectionReason: null,
        decidedAt: null,
        decidedBy: null,
        createdLeaseId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    await expect(
      service.createForTenant(tenantId, { campaignId }, tenantCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  // ---- Tenant withdraw ---------------------------------------------

  it('tenant withdraws own SUBMITTED → WITHDRAWN + audit', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    const w = await service.withdrawForTenant(tenantId, a.id, tenantCtx);
    expect(w.status).toBe('WITHDRAWN');
    expect(store.auditRows.at(-1)?.action).toBe('application.withdraw');
  });

  it('cross-tenant withdraw → 404', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    await expect(service.withdrawForTenant(otherTenantId, a.id, tenantCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('withdraw terminal application → 422 not_decidable', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    store.applications.find((x) => x.id === a.id)!.status = 'ACCEPTED';
    await expect(service.withdrawForTenant(tenantId, a.id, tenantCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  // ---- Owner accept (the heavy transaction) -------------------------

  it('owner accept mints a DRAFT lease, closes the campaign, auto-rejects siblings, audits each', async () => {
    const accepted = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    const sibling = await service.createForTenant(
      otherTenantId,
      { campaignId },
      { ...tenantCtx, actorId: otherTenantId },
    );

    const result = await service.acceptForOwner(ownerId, campaignId, accepted.id, ownerCtx);
    expect(result.status).toBe('ACCEPTED');
    expect(result.createdLeaseId).not.toBeNull();
    expect(store.leases).toHaveLength(1);
    expect(store.leases[0]).toMatchObject({
      ownerId,
      tenantId,
      unitId,
      status: 'DRAFT',
      rentAmount: 5_000_000,
      currency: 'VND',
    });
    expect(store.campaigns[0]?.status).toBe('CLOSED');
    const siblingRow = store.applications.find((a) => a.id === sibling.id)!;
    expect(siblingRow.status).toBe('REJECTED');
    expect(siblingRow.rejectionReason).toBe('Listing was filled.');

    const actions = store.auditRows.map((r) => r.action);
    expect(actions).toContain('application.accept');
    expect(actions).toContain('lease.create_from_application');
    expect(actions).toContain('application.auto_reject');
  });

  it('accept when campaign is not LIVE → 422', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    store.campaigns[0]!.status = 'CLOSED';
    await expect(
      service.acceptForOwner(ownerId, campaignId, a.id, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('accept when unit is OCCUPIED → 409 unit_not_vacant', async () => {
    boot({ unitStatus: 'OCCUPIED' });
    // Need the campaign to still be visible; create application directly.
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    await expect(
      service.acceptForOwner(ownerId, campaignId, a.id, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('cross-owner accept → 404', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    await expect(
      service.acceptForOwner('other_owner', campaignId, a.id, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  // ---- Owner reject -------------------------------------------------

  it('owner reject with reason → REJECTED + reason stored + audit', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    const r = await service.rejectForOwner(
      ownerId,
      campaignId,
      a.id,
      { reason: 'tenant history' },
      ownerCtx,
    );
    expect(r.status).toBe('REJECTED');
    expect(r.rejectionReason).toBe('tenant history');
    const last = store.auditRows.at(-1);
    expect(last?.action).toBe('application.reject');
    expect((last?.meta as Record<string, unknown>).reason).toBe('tenant history');
  });

  it('reject a terminal application → 422 not_decidable', async () => {
    const a = await service.createForTenant(tenantId, { campaignId }, tenantCtx);
    store.applications.find((x) => x.id === a.id)!.status = 'WITHDRAWN';
    await expect(
      service.rejectForOwner(ownerId, campaignId, a.id, { reason: 'x' }, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });
});
