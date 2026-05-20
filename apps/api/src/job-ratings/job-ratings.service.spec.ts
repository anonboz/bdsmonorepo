import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JobRatingsService } from './job-ratings.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface JobSeed {
  id: string;
  ownerId: string;
  partnerId: string;
  partnerUserId: string;
  status: 'REQUESTED' | 'QUOTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

interface RatingRow {
  id: string;
  jobId: string;
  raterId: string;
  ratedId: string;
  direction: 'OWNER_TO_PARTNER' | 'PARTNER_TO_OWNER';
  score: number;
  comment: string | null;
  createdAt: Date;
  rater: { displayName: string };
  rated: { displayName: string };
}

function makePrismaStub(jobs: JobSeed[], userNames: Record<string, string>) {
  const ratings: RatingRow[] = [];
  const auditRows: Record<string, unknown>[] = [];

  function selectJobForRating(j: JobSeed) {
    return {
      id: j.id,
      ownerId: j.ownerId,
      partnerId: j.partnerId,
      status: j.status,
      partner: { userId: j.partnerUserId, deletedAt: null },
    };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    serviceJob: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const j = jobs.find((x) => x.id === where.id);
        return Promise.resolve(j ? selectJobForRating(j) : null);
      }),
    },
    jobRating: {
      create: vi.fn(
        ({ data }: { data: Omit<RatingRow, 'id' | 'createdAt' | 'rater' | 'rated'> }) => {
          // Enforce the @@unique([jobId, direction]) constraint.
          const dup = ratings.find((r) => r.jobId === data.jobId && r.direction === data.direction);
          if (dup) {
            throw new Prisma.PrismaClientKnownRequestError('unique', {
              code: 'P2002',
              clientVersion: 'test',
            });
          }
          const row: RatingRow = {
            id: `rt_${ratings.length + 1}`,
            ...data,
            comment: data.comment ?? null,
            createdAt: new Date(),
            rater: { displayName: userNames[data.raterId] ?? 'Unknown' },
            rated: { displayName: userNames[data.ratedId] ?? 'Unknown' },
          };
          ratings.push(row);
          return Promise.resolve(row);
        },
      ),
      findMany: vi.fn(({ where }: { where: { jobId: string } }) =>
        Promise.resolve(ratings.filter((r) => r.jobId === where.jobId)),
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
  return { stub, ratings, auditRows };
}

describe('JobRatingsService', () => {
  const ownerId = 'user_owner_1';
  const partnerUserId = 'user_partner_1';
  const partnerId = 'pp_1';
  const jobId = 'job_1';
  const userNames = {
    [ownerId]: 'Owen Owner',
    [partnerUserId]: 'Patty Partner',
  };

  let service: JobRatingsService;
  let store: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    store = makePrismaStub(
      [{ id: jobId, ownerId, partnerId, partnerUserId, status: 'COMPLETED' }],
      userNames,
    );
    service = new JobRatingsService(store.stub as never, new AuditLogger(store.stub as never));
  });

  const ctx = { actorId: ownerId, ip: null, userAgent: null };

  it('owner rates partner on COMPLETED job → row created + audit', async () => {
    const r = await service.rateForOwner(
      ownerId,
      jobId,
      { score: 5, comment: 'great' },
      { ...ctx, actorId: ownerId },
    );
    expect(r.direction).toBe('OWNER_TO_PARTNER');
    expect(r.score).toBe(5);
    expect(r.raterName).toBe('Owen Owner');
    expect(r.ratedName).toBe('Patty Partner');
    expect(store.auditRows[0]).toMatchObject({
      action: 'job.rating.write',
      target: `JobRating:${r.id}`,
    });
  });

  it('partner rates owner on COMPLETED job → row created', async () => {
    const r = await service.rateForPartner(
      partnerUserId,
      jobId,
      { score: 4 },
      { ...ctx, actorId: partnerUserId },
    );
    expect(r.direction).toBe('PARTNER_TO_OWNER');
    expect(r.score).toBe(4);
    expect(r.comment).toBeNull();
  });

  it('rating a non-COMPLETED job → 422 rating_not_decidable', async () => {
    store = makePrismaStub(
      [{ id: jobId, ownerId, partnerId, partnerUserId, status: 'IN_PROGRESS' }],
      userNames,
    );
    service = new JobRatingsService(store.stub as never, new AuditLogger(store.stub as never));
    await expect(
      service.rateForOwner(ownerId, jobId, { score: 5 }, { ...ctx, actorId: ownerId }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('double-submit same direction → 409 rating_already_given', async () => {
    await service.rateForOwner(ownerId, jobId, { score: 5 }, { ...ctx, actorId: ownerId });
    await expect(
      service.rateForOwner(ownerId, jobId, { score: 4 }, { ...ctx, actorId: ownerId }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('cross-owner rating → 404 (existence-hiding)', async () => {
    await expect(
      service.rateForOwner(
        'user_other_owner',
        jobId,
        { score: 5 },
        {
          ...ctx,
          actorId: 'user_other_owner',
        },
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('cross-partner rating → 404 (existence-hiding)', async () => {
    await expect(
      service.rateForPartner(
        'user_other_partner',
        jobId,
        { score: 5 },
        {
          ...ctx,
          actorId: 'user_other_partner',
        },
      ),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('getStateForOwner returns both directions (nullable until written)', async () => {
    const before = await service.getStateForOwner(ownerId, jobId);
    expect(before.ownerToPartner).toBeNull();
    expect(before.partnerToOwner).toBeNull();

    await service.rateForOwner(ownerId, jobId, { score: 5 }, { ...ctx, actorId: ownerId });
    await service.rateForPartner(
      partnerUserId,
      jobId,
      { score: 3 },
      { ...ctx, actorId: partnerUserId },
    );

    const after = await service.getStateForOwner(ownerId, jobId);
    expect(after.ownerToPartner?.score).toBe(5);
    expect(after.partnerToOwner?.score).toBe(3);
  });
});
