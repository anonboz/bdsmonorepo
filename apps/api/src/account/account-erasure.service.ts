import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ErrorCodes, type AccountErasureRequestResponse } from '@repo/shared';

import { AdminUsersService } from '../admin/admin-users.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { MailerService } from '../common/mailer/mailer.service.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { env } from '../env.js';
import { PlatformConfigService } from '../platform/platform-config.service.js';

const UNDO_TOKEN_BYTES = 32; // 64-char hex

/**
 * Phase 10.6 — owner of the self-serve account-deletion lifecycle.
 *
 * The flow:
 *
 *   1. User hits `POST /v1/me/erase-request` → {@link request}
 *      creates / refreshes the pending row, generates a single-use
 *      undo token, sends the confirmation email.
 *   2. User cancels (auth'd DELETE or public undo) → {@link cancel}
 *      stamps `cancelledAt` + sends the cancellation email.
 *   3. Daily sweeper → {@link executeIfDue} picks up rows past
 *      `executeAfter` with no cancel / completion stamp, delegates
 *      to {@link AdminUsersService.performErasure} for the actual
 *      anonymization, then stamps `completedAt` + sends the goodbye
 *      email.
 */
@Injectable()
export class AccountErasureService {
  private readonly logger = new Logger(AccountErasureService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly admin: AdminUsersService,
    private readonly audit: AuditLogger,
    private readonly mailer: MailerService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // ---- Reads --------------------------------------------------------

  async getForUser(userId: string): Promise<AccountErasureRequestResponse | null> {
    const row = await this.prisma.accountErasureRequest.findUnique({ where: { userId } });
    if (!row) return null;
    return toResponse(row);
  }

  // ---- request ------------------------------------------------------

  /**
   * Schedules erasure for the caller. Idempotent — re-requesting on
   * an active pending row returns the same `executeAfter` (no token
   * rotation, no fresh email). Re-requesting after a cancel or
   * completion produces a brand-new row.
   *
   * 422 when the user has already been erased (defensive — the auth
   * layer would normally refuse the call before it lands here).
   */
  async request(userId: string, ctx: RequestContext): Promise<AccountErasureRequestResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.ACCOUNT_ALREADY_ERASED,
        title: 'Account is already erased',
      });
    }

    const existing = await this.prisma.accountErasureRequest.findUnique({ where: { userId } });
    if (existing?.cancelledAt === null && existing.completedAt === null) {
      // Idempotent — return the pending row unchanged.
      return toResponse(existing);
    }

    const config = await this.platformConfig.get();
    const now = new Date();
    const executeAfter = new Date(
      now.getTime() + config.accountErasureGraceDays * 24 * 60 * 60 * 1000,
    );
    const undoToken = randomBytes(UNDO_TOKEN_BYTES).toString('hex');

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.accountErasureRequest.upsert({
        where: { userId },
        create: { userId, executeAfter, undoToken },
        update: {
          executeAfter,
          undoToken,
          requestedAt: now,
          cancelledAt: null,
          completedAt: null,
        },
      });
      await this.audit.write(tx, {
        actorId: userId,
        action: 'account.erasure.requested',
        target: `User:${userId}`,
        meta: { executeAfter: executeAfter.toISOString() },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    });

    if (user.email) {
      const url = buildUndoUrl(undoToken);
      await this.mailer
        .send({
          to: user.email,
          subject: 'Your account is scheduled for deletion',
          html: `<p>Hi,</p><p>Your account is scheduled for deletion on <strong>${executeAfter.toUTCString()}</strong>.</p><p>If you didn't request this, <a href="${url}">undo immediately</a>.</p>`,
          text: `Your account is scheduled for deletion on ${executeAfter.toUTCString()}.\n\nIf you didn't request this, undo at: ${url}`,
        })
        .catch((err) => {
          // Mailer down — the row is already persisted, the user can
          // still cancel via the in-app DELETE. Don't bubble.
          this.logger.warn(
            `account.erasure.requested email failed for ${userId}: ${(err as Error).message}`,
          );
        });
    }

    return toResponse(row);
  }

  // ---- cancel -------------------------------------------------------

  async cancel(userId: string, ctx: RequestContext): Promise<void> {
    const row = await this.prisma.accountErasureRequest.findUnique({ where: { userId } });
    if (!row || row.cancelledAt || row.completedAt) {
      // Idempotent — nothing to undo (or already terminal).
      return;
    }
    await this.markCancelled(row.userId, ctx);
  }

  /**
   * Public undo path. Token comes from the confirmation email; we
   * validate it against the pending row + 422 on mismatch.
   */
  async cancelByToken(token: string): Promise<void> {
    const row = await this.prisma.accountErasureRequest.findFirst({
      where: { undoToken: token, cancelledAt: null, completedAt: null },
    });
    if (!row) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.ACCOUNT_ERASURE_TOKEN_INVALID,
        title: 'Erasure cancellation token is invalid or already used',
      });
    }
    await this.markCancelled(row.userId, { actorId: row.userId, ip: null, userAgent: null });
  }

  private async markCancelled(userId: string, ctx: RequestContext): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountErasureRequest.update({
        where: { userId },
        data: { cancelledAt: now },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'account.erasure.cancelled',
        target: `User:${userId}`,
        meta: { cancelledAt: now.toISOString() },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email) {
      await this.mailer
        .send({
          to: user.email,
          subject: 'Your account deletion was cancelled',
          html: '<p>Hi,</p><p>Your scheduled account deletion has been cancelled. No further action is needed.</p>',
          text: 'Your scheduled account deletion has been cancelled. No further action is needed.',
        })
        .catch((err) => {
          this.logger.warn(
            `account.erasure.cancelled email failed for ${userId}: ${(err as Error).message}`,
          );
        });
    }
  }

  // ---- sweeper ------------------------------------------------------

  /**
   * Picks every row past `executeAfter` with no cancel / completion,
   * runs the 9.3 anonymization flow per-row, stamps `completedAt`,
   * sends the goodbye email. Failures on a single row don't stop the
   * batch — we log + continue.
   */
  async executeIfDue(now: Date = new Date()): Promise<{ executed: number; skipped: number }> {
    const due = await this.prisma.accountErasureRequest.findMany({
      where: {
        executeAfter: { lte: now },
        cancelledAt: null,
        completedAt: null,
      },
      select: { userId: true },
    });

    let executed = 0;
    let skipped = 0;
    for (const row of due) {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true, deletedAt: true },
      });
      if (!user || user.deletedAt) {
        // Already erased (admin path beat us). Mark complete + move on.
        await this.prisma.accountErasureRequest.update({
          where: { userId: row.userId },
          data: { completedAt: now },
        });
        skipped += 1;
        continue;
      }
      const ctx: RequestContext = { actorId: row.userId, ip: null, userAgent: null };
      try {
        await this.admin.performErasure(row.userId, ctx);
      } catch (err) {
        this.logger.warn(
          `account.erasure execute failed for ${row.userId}: ${(err as Error).message}`,
        );
        continue;
      }
      await this.prisma.accountErasureRequest.update({
        where: { userId: row.userId },
        data: { completedAt: now },
      });
      if (user.email) {
        await this.mailer
          .send({
            to: user.email,
            subject: 'Your account has been deleted',
            html: '<p>Hi,</p><p>Your account has been deleted. Thanks for using BDS.</p>',
            text: 'Your account has been deleted. Thanks for using BDS.',
          })
          .catch((err) => {
            this.logger.warn(
              `account.erasure goodbye email failed for ${row.userId}: ${(err as Error).message}`,
            );
          });
      }
      executed += 1;
    }
    if (executed > 0 || skipped > 0) {
      this.logger.log(`account erasure sweep: executed=${executed} skipped=${skipped}`);
    }
    return { executed, skipped };
  }
}

interface AccountErasureRow {
  requestedAt: Date;
  executeAfter: Date;
  cancelledAt: Date | null;
  completedAt: Date | null;
}

function toResponse(row: AccountErasureRow): AccountErasureRequestResponse {
  return {
    requestedAt: row.requestedAt.toISOString(),
    executeAfter: row.executeAfter.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function buildUndoUrl(token: string): string {
  const base = env.TENANT_APP_URL.replace(/\/$/, '');
  return `${base}/account/erase-cancel?token=${encodeURIComponent(token)}`;
}
