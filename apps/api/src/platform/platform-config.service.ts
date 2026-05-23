import { Inject, Injectable, Logger } from '@nestjs/common';

import type { PlatformConfig, UpdatePlatformConfigInput } from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/** Schema default — the canonical seed value also lives in the
 *  Prisma model and the seed migration. Triple-sourcing the literal
 *  is annoying but keeps each layer self-bootstrapping. */
const DEFAULT_COMMISSION_BPS = 1000;
/** Phase 10.6 — default grace window between self-serve erasure
 *  request and execution. Mirrored in the Prisma model. */
const DEFAULT_ACCOUNT_ERASURE_GRACE_DAYS = 7;

/**
 * Singleton platform-config row backed by `PlatformConfig` (Phase 9.6).
 * `get()` always succeeds — even when the row is missing it returns
 * the schema defaults so the API never 404s on a hot path.
 *
 * `@Global()`-mounted via {@link PlatformConfigModule} so ServiceJobs
 * + the admin controller can inject without explicit `imports`.
 */
@Injectable()
export class PlatformConfigService {
  private readonly logger = new Logger(PlatformConfigService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  async get(): Promise<PlatformConfig> {
    const row = await this.prisma.platformConfig.findUnique({ where: { id: 'singleton' } });
    if (!row) {
      // Defensive — the migration seeds the row, so this only fires
      // on a manually-mucked DB. Log + serve defaults so the rest of
      // the system keeps working.
      this.logger.warn('PlatformConfig singleton row missing — serving schema defaults');
      return {
        commissionBps: DEFAULT_COMMISSION_BPS,
        accountErasureGraceDays: DEFAULT_ACCOUNT_ERASURE_GRACE_DAYS,
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      commissionBps: row.commissionBps,
      accountErasureGraceDays: row.accountErasureGraceDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Upserts the singleton + writes an audit row inside one
   * transaction. Both succeed or both roll back — same protocol as
   * every other admin-mutation in the codebase.
   */
  async update(input: UpdatePlatformConfigInput, ctx: RequestContext): Promise<PlatformConfig> {
    const previous = await this.prisma.platformConfig.findUnique({
      where: { id: 'singleton' },
    });
    const previousBps = previous?.commissionBps ?? DEFAULT_COMMISSION_BPS;
    const previousGrace = previous?.accountErasureGraceDays ?? DEFAULT_ACCOUNT_ERASURE_GRACE_DAYS;
    const nextBps = input.commissionBps ?? previousBps;
    const nextGrace = input.accountErasureGraceDays ?? previousGrace;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.platformConfig.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          commissionBps: nextBps,
          accountErasureGraceDays: nextGrace,
        },
        update: { commissionBps: nextBps, accountErasureGraceDays: nextGrace },
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'platform.config.update',
        target: 'PlatformConfig:singleton',
        meta: {
          previousBps,
          nextBps,
          previousAccountErasureGraceDays: previousGrace,
          nextAccountErasureGraceDays: nextGrace,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return row;
    });

    return {
      commissionBps: updated.commissionBps,
      accountErasureGraceDays: updated.accountErasureGraceDays,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}
