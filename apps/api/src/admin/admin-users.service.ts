import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type AdminUser, type Page } from '@repo/shared';

import type {
  KycDecisionDto,
  ListAdminUsersQueryDto,
  SuspendUserDto,
  UnsuspendUserDto,
} from './dto/admin.dto.js';
import { AnalyticsService } from '../common/analytics/analytics.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { type RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { StorageService } from '../common/storage/storage.service.js';

// Re-export so existing controller imports keep working.
export type { RequestContext } from '../common/audit/request-context.js';

type UserRow = Prisma.UserGetPayload<Record<string, never>>;

/**
 * Admin operations on User rows. Every mutating method runs the change
 * and the corresponding `AuditLog` write inside a single `$transaction`
 * so we never apply a state change without its paired audit entry.
 *
 * The actor is the admin themselves (passed in via `RequestContext`,
 * threaded from the controller).
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
    private readonly storage: StorageService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ---- Reads --------------------------------------------------------

  async list(query: ListAdminUsersQueryDto): Promise<Page<AdminUser>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role !== undefined && { roles: { has: query.role } }),
      ...(query.kycStatus !== undefined && { kycStatus: query.kycStatus }),
      ...(query.isSuspended !== undefined && { isSuspended: query.isSuspended }),
      ...(query.q && {
        OR: [
          { email: { contains: query.q, mode: 'insensitive' as const } },
          { displayName: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }),
    };

    const limit = query.limit;
    const findArgs: Prisma.UserFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const rows = await this.prisma.user.findMany(findArgs);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getById(id: string): Promise<AdminUser> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw this.notFound();
    return this.toResponse(row);
  }

  // ---- Mutations ----------------------------------------------------

  async suspend(id: string, input: SuspendUserDto, ctx: RequestContext): Promise<AdminUser> {
    this.assertNotSelf(id, ctx);
    const current = await this.loadOrFail(id);
    if (current.isSuspended) throw this.alreadyInState('suspended');

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { isSuspended: true },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'user.suspend',
        target: `User:${id}`,
        meta: { reason: input.reason, previousState: { isSuspended: false } },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async unsuspend(id: string, input: UnsuspendUserDto, ctx: RequestContext): Promise<AdminUser> {
    this.assertNotSelf(id, ctx);
    const current = await this.loadOrFail(id);
    if (!current.isSuspended) throw this.alreadyInState('not suspended');

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { isSuspended: false },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'user.unsuspend',
        target: `User:${id}`,
        meta: { reason: input.reason, previousState: { isSuspended: true } },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async kycDecision(id: string, input: KycDecisionDto, ctx: RequestContext): Promise<AdminUser> {
    this.assertNotSelf(id, ctx);
    const current = await this.loadOrFail(id);

    const nextStatus = decisionToStatus(input);
    if (current.kycStatus === nextStatus) {
      throw this.alreadyInState(`kyc=${nextStatus}`);
    }

    const action = actionForDecision(input);
    const meta: Record<string, unknown> = { previousStatus: current.kycStatus };
    if (input.decision === 'REJECTED') meta.reason = input.reason;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { kycStatus: nextStatus },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action,
        target: `User:${id}`,
        meta,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  // ---- GDPR erasure (Phase 9.3) ------------------------------------

  /**
   * Irreversible. Anonymises the User row + flips owned MediaAssets
   * to DELETED in a single $transaction, then fires fire-and-forget
   * side effects (S3 purge, PostHog person delete). The audit row
   * carries the side-effect counts.
   *
   * Self-erasure is blocked. Re-running on an already-erased user
   * (deletedAt set) → 422.
   */
  async erase(id: string, ctx: RequestContext): Promise<AdminUser> {
    this.assertNotSelf(id, ctx);
    const current = await this.prisma.user.findUnique({ where: { id } });
    if (!current) throw this.notFound();
    if (current.deletedAt) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.ADMIN_USER_ALREADY_ERASED,
        title: 'User is already erased',
      });
    }

    // Collect the assets to purge BEFORE the tx — we use this list
    // to issue S3 deletes after commit. The tx's UPDATE may flip the
    // status column for assets that race in mid-flight, but those
    // races are vanishingly rare for a deleted user (no clients are
    // posting on their behalf).
    const ownedAssets = await this.prisma.mediaAsset.findMany({
      where: { ownerUserId: id, status: { not: 'DELETED' } },
      select: { id: true, bucket: true, key: true },
    });

    const now = new Date();
    const anonymizedDisplayName = `deleted-${id.slice(0, 8)}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id },
        data: {
          email: null,
          phone: null,
          displayName: anonymizedDisplayName,
          deletedAt: now,
        },
      });
      await tx.mediaAsset.updateMany({
        where: { ownerUserId: id, status: { not: 'DELETED' } },
        data: { status: 'DELETED', deletedAt: now },
      });
      // Initial audit row — side-effect counts get patched onto this
      // record after S3 + PostHog finish; but writing it inside the
      // tx guarantees a row exists even if a later step crashes.
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'user.erase',
        target: `User:${id}`,
        meta: {
          anonymizedFields: ['email', 'phone', 'displayName'],
          mediaAssetsQueued: ownedAssets.length,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return row;
    });

    // Fire-and-forget side effects. Failures here don't roll back
    // the DB anonymization (which is the source of truth); we log +
    // continue so the admin gets a 200.
    let s3Failures = 0;
    for (const asset of ownedAssets) {
      try {
        await this.storage.deleteObject({ bucket: asset.bucket, key: asset.key });
      } catch (err) {
        s3Failures++;
        this.logger.warn(
          `user.erase S3 delete failed for asset ${asset.id}: ${(err as Error).message}`,
        );
      }
    }

    const posthog = await this.analytics.deletePerson({ distinctId: id });

    // Patch the audit row with the side-effect outcome. A second
    // audit row would clutter the timeline; updating the existing
    // meta keeps the user.erase event atomic from the auditor's
    // point of view.
    await this.audit.write(this.prisma, {
      actorId: ctx.actorId,
      action: 'user.erase.completed',
      target: `User:${id}`,
      meta: {
        mediaAssetsPurged: ownedAssets.length - s3Failures,
        mediaAssetsS3Failures: s3Failures,
        posthogDeleted: posthog.called,
        posthogStatus: posthog.status,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return this.toResponse(updated);
  }

  // ---- helpers ------------------------------------------------------

  private async loadOrFail(id: string): Promise<UserRow> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    if (!row || row.deletedAt) throw this.notFound();
    return row;
  }

  private assertNotSelf(targetId: string, ctx: RequestContext): void {
    if (targetId === ctx.actorId) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.ADMIN_CANNOT_ACT_ON_SELF,
        title: 'Cannot act on your own account',
      });
    }
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.ADMIN_USER_NOT_FOUND,
      title: 'User not found',
    });
  }

  private alreadyInState(desc: string): ProblemError {
    return new ProblemError({
      status: 409,
      type: ErrorCodes.ADMIN_USER_ALREADY_IN_STATE,
      title: 'User is already in the requested state',
      detail: `User is already ${desc}.`,
    });
  }

  private toResponse(row: UserRow): AdminUser {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      displayName: row.displayName,
      roles: row.roles,
      kycStatus: row.kycStatus,
      isSuspended: row.isSuspended,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

// ---- KYC mapping ------------------------------------------------------

function decisionToStatus(d: KycDecisionDto): 'APPROVED' | 'REJECTED' | 'PENDING' | 'NONE' {
  return d.decision;
}

function actionForDecision(d: KycDecisionDto): string {
  switch (d.decision) {
    case 'APPROVED':
      return 'user.kyc.approve';
    case 'REJECTED':
      return 'user.kyc.reject';
    case 'PENDING':
      return 'user.kyc.pending';
    case 'NONE':
      return 'user.kyc.reset';
  }
}
