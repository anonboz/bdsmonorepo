import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { AuditLogEntry, Page } from '@repo/shared';

import type { ListAuditLogQueryDto } from './dto/admin.dto.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type AuditRow = Prisma.AuditLogGetPayload<{
  include: { actor: { select: { displayName: true } } };
}>;

@Injectable()
export class AdminAuditService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async list(query: ListAuditLogQueryDto): Promise<Page<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId !== undefined && { actorId: query.actorId }),
      ...(query.action !== undefined && { action: { startsWith: query.action } }),
      ...(query.target !== undefined && { target: query.target }),
    };

    const limit = query.limit;
    const findArgs: Prisma.AuditLogFindManyArgs = {
      where,
      // Newest first by default — flips with ?sort=asc.
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      include: { actor: { select: { displayName: true } } },
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const rows = (await this.prisma.auditLog.findMany(findArgs)) as AuditRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private toResponse(row: AuditRow): AuditLogEntry {
    return {
      id: row.id,
      actorId: row.actorId,
      actorName: row.actor?.displayName ?? null,
      action: row.action,
      target: row.target,
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
