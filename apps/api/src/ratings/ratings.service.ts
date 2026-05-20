import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type LeaseRating,
  type LeaseRatingState,
  type Page,
  RatingDirection,
  type RatingMilestone,
  RatingMilestone as RatingMilestoneEnum,
  type RatingMilestoneState,
  type UserRatingSummary,
} from '@repo/shared';

import type { CreateLeaseRatingDto, ListLeaseRatingsQueryDto } from './dto/ratings.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const RATING_WITH_PARTIES = {
  include: {
    rater: { select: { displayName: true } },
    rated: { select: { displayName: true } },
  },
} satisfies Prisma.LeaseRatingDefaultArgs;

type RatingRow = Prisma.LeaseRatingGetPayload<typeof RATING_WITH_PARTIES>;

interface LeaseLite {
  id: string;
  ownerId: string;
  tenantId: string;
  status: 'DRAFT' | 'ACTIVE' | 'ENDED' | 'TERMINATED';
  startDate: Date;
  endDate: Date | null;
  deletedAt: Date | null;
  unitId: string;
  unit: { houseId: string };
}

const MILESTONE_ORDER: RatingMilestone[] = [
  RatingMilestoneEnum.MOVE_IN,
  RatingMilestoneEnum.MID_LEASE,
  RatingMilestoneEnum.MOVE_OUT,
];

const MID_LEASE_FALLBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Lease ratings.
 *
 * Multi-party authorization:
 * - **TENANT** named on the lease → writes only `TENANT_TO_OWNER`.
 * - **OWNER** of the parent house → writes only `OWNER_TO_TENANT`.
 * - **Any authenticated user** can read another user's aggregate summary
 *   (intentionally public-ish for Phase 4 listings) but only the rated party
 *   sees individual rating rows + comments.
 *
 * Milestone windows are computed at read time. No worker, no denormalized
 * aggregate — fast enough at our scale and avoids drift bugs.
 */
@Injectable()
export class RatingsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  // ---- Tenant-scoped ------------------------------------------------

  async stateForTenant(tenantId: string, leaseId: string): Promise<LeaseRatingState> {
    const lease = await this.loadLeaseForTenant(tenantId, leaseId);
    return this.computeState(lease, 'TENANT_TO_OWNER');
  }

  async createForTenant(
    tenantId: string,
    tenantName: string,
    leaseId: string,
    input: CreateLeaseRatingDto,
  ): Promise<LeaseRating> {
    const lease = await this.loadLeaseForTenant(tenantId, leaseId);
    return this.submit(lease, 'TENANT_TO_OWNER', tenantId, tenantName, lease.ownerId, input);
  }

  // ---- Owner-scoped -------------------------------------------------

  async stateForOwner(
    ownerId: string,
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<LeaseRatingState> {
    const lease = await this.loadLeaseForOwner(ownerId, houseId, unitId, leaseId);
    return this.computeState(lease, 'OWNER_TO_TENANT');
  }

  async createForOwner(
    ownerId: string,
    ownerName: string,
    houseId: string,
    unitId: string,
    leaseId: string,
    input: CreateLeaseRatingDto,
  ): Promise<LeaseRating> {
    const lease = await this.loadLeaseForOwner(ownerId, houseId, unitId, leaseId);
    return this.submit(lease, 'OWNER_TO_TENANT', ownerId, ownerName, lease.tenantId, input);
  }

  // ---- Self-read (any authenticated user) --------------------------

  async listReceived(userId: string, query: ListLeaseRatingsQueryDto): Promise<Page<LeaseRating>> {
    return this.paginate({ ratedId: userId }, query);
  }

  async summaryForUser(userId: string): Promise<UserRatingSummary> {
    const agg = await this.prisma.leaseRating.aggregate({
      where: { ratedId: userId },
      _avg: { score: true },
      _count: { _all: true },
    });
    return {
      userId,
      average: agg._avg.score ?? null,
      count: agg._count._all,
    };
  }

  // ---- helpers ------------------------------------------------------

  private async submit(
    lease: LeaseLite,
    direction: 'TENANT_TO_OWNER' | 'OWNER_TO_TENANT',
    raterId: string,
    raterName: string,
    ratedId: string,
    input: CreateLeaseRatingDto,
  ): Promise<LeaseRating> {
    const open = this.milestoneIsOpen(lease, input.milestone);
    if (!open.isOpen) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.RATING_MILESTONE_LOCKED,
        title: 'Rating milestone not yet open',
        detail: open.reason ?? 'This milestone is not available to rate.',
      });
    }

    try {
      const created = await this.prisma.leaseRating.create({
        data: {
          leaseId: lease.id,
          raterId,
          ratedId,
          direction: RatingDirection[direction],
          milestone: input.milestone,
          score: input.score,
          comment: input.comment ?? null,
        },
        ...RATING_WITH_PARTIES,
      });
      return this.toResponse(created, raterName);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' // unique constraint
      ) {
        throw new ProblemError({
          status: 409,
          type: ErrorCodes.RATING_ALREADY_GIVEN,
          title: 'Already rated',
          detail: 'You have already submitted a rating for this milestone.',
        });
      }
      throw err;
    }
  }

  private async computeState(
    lease: LeaseLite,
    direction: 'TENANT_TO_OWNER' | 'OWNER_TO_TENANT',
  ): Promise<LeaseRatingState> {
    const rated = await this.prisma.leaseRating.findMany({
      where: { leaseId: lease.id, direction: RatingDirection[direction] },
      select: { milestone: true },
    });
    const ratedSet = new Set<RatingMilestone>(rated.map((r) => r.milestone));
    const milestones: RatingMilestoneState[] = MILESTONE_ORDER.map((milestone) => {
      const open = this.milestoneIsOpen(lease, milestone);
      const already = ratedSet.has(milestone);
      return {
        milestone,
        opensAt: open.opensAt ? open.opensAt.toISOString() : null,
        isOpen: open.isOpen && !already,
        reason: already ? 'ALREADY_RATED' : open.reason,
        alreadyRated: already,
      };
    });
    return { leaseId: lease.id, direction: RatingDirection[direction], milestones };
  }

  /**
   * Returns whether a milestone is currently open along with the timestamp at
   * which it opens (or `null` when the trigger is a status flip rather than a
   * date). The unique constraint on (leaseId, direction, milestone) makes the
   * "already rated" check a separate path — see `computeState`.
   */
  private milestoneIsOpen(
    lease: LeaseLite,
    milestone: RatingMilestone,
  ): { isOpen: boolean; opensAt: Date | null; reason: string | null } {
    if (lease.status === 'DRAFT') {
      return { isOpen: false, opensAt: null, reason: 'LEASE_DRAFT' };
    }

    const start = lease.startDate;
    const end = lease.endDate;
    const now = Date.now();

    if (milestone === RatingMilestoneEnum.MOVE_IN) {
      const opensAt = start;
      const isOpen = now >= opensAt.getTime();
      return { isOpen, opensAt, reason: isOpen ? null : 'BEFORE_OPENS_AT' };
    }

    if (milestone === RatingMilestoneEnum.MID_LEASE) {
      const fallback = new Date(start.getTime() + MID_LEASE_FALLBACK_MS);
      const opensAt = end
        ? new Date(Math.min((start.getTime() + end.getTime()) / 2, fallback.getTime()))
        : fallback;
      const isOpen = now >= opensAt.getTime();
      return { isOpen, opensAt, reason: isOpen ? null : 'BEFORE_OPENS_AT' };
    }

    // MOVE_OUT: opens at endDate (if set) OR when lease transitions to
    // ENDED/TERMINATED — whichever comes first.
    const statusEnded = lease.status === 'ENDED' || lease.status === 'TERMINATED';
    if (statusEnded) {
      return { isOpen: true, opensAt: end ?? start, reason: null };
    }
    if (end) {
      const isOpen = now >= end.getTime();
      return { isOpen, opensAt: end, reason: isOpen ? null : 'BEFORE_OPENS_AT' };
    }
    return { isOpen: false, opensAt: null, reason: 'LEASE_NOT_ENDED' };
  }

  private async paginate(
    where: Prisma.LeaseRatingWhereInput,
    query: ListLeaseRatingsQueryDto,
  ): Promise<Page<LeaseRating>> {
    const limit = query.limit;
    const findArgs: Prisma.LeaseRatingFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...RATING_WITH_PARTIES,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.leaseRating.findMany(findArgs)) as RatingRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async loadLeaseForTenant(tenantId: string, leaseId: string): Promise<LeaseLite> {
    const lease = await this.findLease(leaseId);
    if (lease?.tenantId !== tenantId) throw this.leaseNotFound();
    return lease;
  }

  private async loadLeaseForOwner(
    ownerId: string,
    houseId: string,
    unitId: string,
    leaseId: string,
  ): Promise<LeaseLite> {
    const lease = await this.findLease(leaseId);
    if (lease?.ownerId !== ownerId || lease.unitId !== unitId || lease.unit.houseId !== houseId) {
      throw this.leaseNotFound();
    }
    return lease;
  }

  private async findLease(leaseId: string): Promise<LeaseLite | null> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: leaseId },
      select: {
        id: true,
        ownerId: true,
        tenantId: true,
        status: true,
        startDate: true,
        endDate: true,
        deletedAt: true,
        unitId: true,
        unit: { select: { houseId: true } },
      },
    });
    if (!lease || lease.deletedAt) return null;
    return lease;
  }

  private leaseNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.RATING_LEASE_INVALID,
      title: 'Lease not found',
    });
  }

  private toResponse(row: RatingRow, raterNameOverride?: string): LeaseRating {
    return {
      id: row.id,
      leaseId: row.leaseId,
      raterId: row.raterId,
      raterName: raterNameOverride ?? row.rater.displayName,
      ratedId: row.ratedId,
      ratedName: row.rated.displayName,
      direction: row.direction,
      milestone: row.milestone,
      score: row.score,
      comment: row.comment,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const RATING_MID_LEASE_FALLBACK_MS = MID_LEASE_FALLBACK_MS;
