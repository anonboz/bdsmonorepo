import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PRISMA, type PrismaInstance } from '../prisma/prisma.token.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Thin writer for `AuditLog`. Designed to be called *inside* a Prisma
 * `$transaction` together with the change it audits — pass the
 * transaction client as `tx` so both the change and the audit row
 * commit (or roll back) atomically.
 *
 *   await this.prisma.$transaction(async (tx) => {
 *     const updated = await tx.user.update(...);
 *     await this.audit.write(tx, { actorId, action: 'user.suspend', ... });
 *     return updated;
 *   });
 *
 * `tx` defaults to the unscoped client when called outside a transaction
 * — useful for retroactive entries, but the atomic path is the norm.
 */
@Injectable()
export class AuditLogger {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async write(tx: Prisma.TransactionClient | PrismaInstance, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        target: entry.target ?? null,
        meta: (entry.meta ?? null) as Prisma.InputJsonValue | typeof Prisma.DbNull,
        ip: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  /** Convenience: write outside any transaction. */
  async writeOnce(entry: AuditEntry): Promise<void> {
    return this.write(this.prisma, entry);
  }
}
