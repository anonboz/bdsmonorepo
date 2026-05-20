import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type JobRating,
  type JobRatingDirection,
  type JobRatingsForJob,
} from '@repo/shared';

import type { CreateJobRatingDto } from './dto/job-ratings.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const RATING_WITH_USERS = {
  include: {
    rater: { select: { displayName: true } },
    rated: { select: { displayName: true } },
  },
} satisfies Prisma.JobRatingDefaultArgs;

type RatingRow = Prisma.JobRatingGetPayload<typeof RATING_WITH_USERS>;

const JOB_FOR_RATING = {
  select: {
    id: true,
    ownerId: true,
    partnerId: true,
    status: true,
    partner: { select: { userId: true, deletedAt: true } },
  },
} satisfies Prisma.ServiceJobDefaultArgs;

type JobForRatingRow = Prisma.ServiceJobGetPayload<typeof JOB_FOR_RATING>;

/**
 * Post-completion ratings between owner and partner on a `ServiceJob`.
 *
 * One row per direction (OWNER_TO_PARTNER, PARTNER_TO_OWNER) per job.
 * Cross-party access returns 404 (existence-hiding). Rating before the
 * job is COMPLETED → 422. Double-submit → 409 (P2002 caught).
 */
@Injectable()
export class JobRatingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  async rateForOwner(
    ownerId: string,
    jobId: string,
    input: CreateJobRatingDto,
    ctx: RequestContext,
  ): Promise<JobRating> {
    const job = await this.loadJob(jobId);
    if (job.ownerId !== ownerId) throw this.notFound();
    this.assertCompleted(job.status);
    const partnerUserId = job.partner.userId;
    return this.create(job.id, ownerId, partnerUserId, 'OWNER_TO_PARTNER', input, ctx);
  }

  async rateForPartner(
    partnerUserId: string,
    jobId: string,
    input: CreateJobRatingDto,
    ctx: RequestContext,
  ): Promise<JobRating> {
    const job = await this.loadJob(jobId);
    if (job.partner.userId !== partnerUserId) throw this.notFound();
    this.assertCompleted(job.status);
    return this.create(job.id, partnerUserId, job.ownerId, 'PARTNER_TO_OWNER', input, ctx);
  }

  async getStateForOwner(ownerId: string, jobId: string): Promise<JobRatingsForJob> {
    const job = await this.loadJob(jobId);
    if (job.ownerId !== ownerId) throw this.notFound();
    return this.loadState(job.id);
  }

  async getStateForPartner(partnerUserId: string, jobId: string): Promise<JobRatingsForJob> {
    const job = await this.loadJob(jobId);
    if (job.partner.userId !== partnerUserId) throw this.notFound();
    return this.loadState(job.id);
  }

  // ---- helpers -----------------------------------------------------

  private async create(
    jobId: string,
    raterId: string,
    ratedId: string,
    direction: JobRatingDirection,
    input: CreateJobRatingDto,
    ctx: RequestContext,
  ): Promise<JobRating> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.jobRating.create({
          data: {
            jobId,
            raterId,
            ratedId,
            direction,
            score: input.score,
            comment: input.comment ?? null,
          },
          ...RATING_WITH_USERS,
        });
        await this.audit.write(tx, {
          actorId: ctx.actorId,
          action: 'job.rating.write',
          target: `JobRating:${created.id}`,
          meta: { jobId, direction, score: input.score },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return created;
      });
      return this.toResponse(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ProblemError({
          status: 409,
          type: ErrorCodes.JOB_RATING_ALREADY_GIVEN,
          title: 'Rating already given',
        });
      }
      throw err;
    }
  }

  private async loadJob(jobId: string): Promise<JobForRatingRow> {
    const row = await this.prisma.serviceJob.findUnique({
      where: { id: jobId },
      ...JOB_FOR_RATING,
    });
    if (!row?.partner) throw this.notFound();
    return row;
  }

  private async loadState(jobId: string): Promise<JobRatingsForJob> {
    const rows = await this.prisma.jobRating.findMany({
      where: { jobId },
      ...RATING_WITH_USERS,
    });
    const ownerToPartner = rows.find((r) => r.direction === 'OWNER_TO_PARTNER') ?? null;
    const partnerToOwner = rows.find((r) => r.direction === 'PARTNER_TO_OWNER') ?? null;
    return {
      jobId,
      ownerToPartner: ownerToPartner ? this.toResponse(ownerToPartner) : null,
      partnerToOwner: partnerToOwner ? this.toResponse(partnerToOwner) : null,
    };
  }

  private assertCompleted(status: JobForRatingRow['status']): void {
    if (status !== 'COMPLETED') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.JOB_RATING_NOT_DECIDABLE,
        title: 'Job not rateable',
        detail: 'Ratings open only after the job is completed.',
      });
    }
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.JOB_NOT_FOUND,
      title: 'Job not found',
    });
  }

  private toResponse(row: RatingRow): JobRating {
    return {
      id: row.id,
      jobId: row.jobId,
      raterId: row.raterId,
      raterName: row.rater.displayName,
      ratedId: row.ratedId,
      ratedName: row.rated.displayName,
      direction: row.direction,
      score: row.score,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
