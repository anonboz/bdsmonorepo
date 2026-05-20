import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type House, type Page } from '@repo/shared';

import type { RequestContext } from './admin-users.service.js';
import { AuditLogger } from './audit-logger.service.js';
import type {
  ClearHouseModerationDto,
  FlagHouseDto,
  ListAdminHousesQueryDto,
  RejectHouseDto,
} from './dto/admin-houses.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const houseWithCount = Prisma.validator<Prisma.HouseDefaultArgs>()({
  include: { _count: { select: { units: true } } },
});

type HouseRow = Prisma.HouseGetPayload<typeof houseWithCount>;

/**
 * Admin moderation operations on `House` rows. Each mutating method runs
 * the change and the corresponding `AuditLog` write inside a single
 * `$transaction` so we never apply a state change without its paired
 * audit entry — mirrors `AdminUsersService`.
 */
@Injectable()
export class AdminHousesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Reads --------------------------------------------------------

  async list(query: ListAdminHousesQueryDto): Promise<Page<House>> {
    const where: Prisma.HouseWhereInput = {
      deletedAt: null,
      ...(query.ownerId !== undefined && { ownerId: query.ownerId }),
      ...(query.moderationStatus !== undefined && {
        moderationStatus: query.moderationStatus,
      }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' as const } },
          { city: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }),
    };

    const limit = query.limit;
    const findArgs: Prisma.HouseFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...houseWithCount,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const rows = (await this.prisma.house.findMany(findArgs)) as HouseRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getById(id: string): Promise<House> {
    const row = await this.loadOrFail(id);
    return this.toResponse(row);
  }

  // ---- Mutations ----------------------------------------------------

  async flag(id: string, input: FlagHouseDto, ctx: RequestContext): Promise<House> {
    const current = await this.loadOrFail(id);
    if (current.moderationStatus === 'FLAGGED') throw this.alreadyInState('FLAGGED');

    // Snapshot the previous values before opening the transaction. We can't
    // read `current.*` from inside the closure — Prisma mutates the same
    // row reference under our test stub, and we want a frozen pre-image.
    const previousStatus = current.moderationStatus;
    const decidedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.house.update({
        where: { id },
        data: {
          moderationStatus: 'FLAGGED',
          moderationReason: input.reason,
          moderationDecidedAt: decidedAt,
          moderationDecidedBy: ctx.actorId,
        },
        ...houseWithCount,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'house.flag',
        target: `House:${id}`,
        meta: { reason: input.reason, previousStatus },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async clear(id: string, input: ClearHouseModerationDto, ctx: RequestContext): Promise<House> {
    const current = await this.loadOrFail(id);
    if (current.moderationStatus === 'OK') throw this.alreadyInState('OK');

    const previousStatus = current.moderationStatus;
    const previousReason = current.moderationReason;
    const decidedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.house.update({
        where: { id },
        data: {
          moderationStatus: 'OK',
          moderationReason: null,
          moderationDecidedAt: decidedAt,
          moderationDecidedBy: ctx.actorId,
        },
        ...houseWithCount,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'house.clear',
        target: `House:${id}`,
        meta: { reason: input.reason, previousStatus, previousReason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async reject(id: string, input: RejectHouseDto, ctx: RequestContext): Promise<House> {
    const current = await this.loadOrFail(id);
    if (current.moderationStatus === 'REJECTED') throw this.alreadyInState('REJECTED');

    const previousStatus = current.moderationStatus;
    const wasPublished = current.isPublished;
    const decidedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.house.update({
        where: { id },
        data: {
          moderationStatus: 'REJECTED',
          moderationReason: input.reason,
          moderationDecidedAt: decidedAt,
          moderationDecidedBy: ctx.actorId,
          ...(wasPublished && { isPublished: false }),
        },
        ...houseWithCount,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'house.reject',
        target: `House:${id}`,
        meta: { reason: input.reason, previousStatus, wasPublished },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async loadOrFail(id: string): Promise<HouseRow> {
    const row = await this.prisma.house.findUnique({ where: { id }, ...houseWithCount });
    if (!row || row.deletedAt) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.ADMIN_HOUSE_NOT_FOUND,
      title: 'House not found',
    });
  }

  private alreadyInState(state: string): ProblemError {
    return new ProblemError({
      status: 409,
      type: ErrorCodes.ADMIN_HOUSE_ALREADY_IN_STATE,
      title: 'House is already in the requested state',
      detail: `House is already ${state}.`,
    });
  }

  private toResponse(row: HouseRow): House {
    return {
      id: row.id,
      ownerId: row.ownerId,
      name: row.name,
      description: row.description,
      address: {
        line1: row.addressLine1,
        ...(row.addressLine2 != null && { line2: row.addressLine2 }),
        city: row.city,
        ...(row.state != null && { state: row.state }),
        ...(row.postalCode != null && { postalCode: row.postalCode }),
        country: row.country,
      },
      geo: row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null,
      unitCount: row._count?.units ?? 0,
      isPublished: row.isPublished,
      moderationStatus: row.moderationStatus,
      moderationReason: row.moderationReason,
      moderationDecidedAt: row.moderationDecidedAt ? row.moderationDecidedAt.toISOString() : null,
      moderationDecidedBy: row.moderationDecidedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
