import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type House, type Page, type Role } from '@repo/shared';

import type { CreateHouseDto, ListHousesQueryDto, UpdateHouseDto } from './dto/houses.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const houseWithCount = Prisma.validator<Prisma.HouseDefaultArgs>()({
  include: { _count: { select: { units: true } } },
});

type HouseRow = Prisma.HouseGetPayload<typeof houseWithCount>;

/**
 * Houses service — the canonical pattern for a domain service in this API.
 *
 * Authorization model:
 * - Mutations require ownership: only the `ownerId` can create/update/delete
 *   their houses. ADMIN can read any house but not mutate (admin moderation
 *   uses dedicated endpoints in Phase 3).
 * - Lists are scoped to the caller's owned set, except for ADMIN which sees
 *   all (including soft-deleted, with a query flag).
 * - Soft-deleted records are filtered out of reads unless explicitly requested.
 */
@Injectable()
export class HousesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async create(ownerId: string, input: CreateHouseDto): Promise<House> {
    const created = await this.prisma.house.create({
      data: {
        ownerId,
        name: input.name,
        description: input.description ?? null,
        addressLine1: input.address.line1,
        addressLine2: input.address.line2 ?? null,
        city: input.address.city,
        state: input.address.state ?? null,
        postalCode: input.address.postalCode ?? null,
        country: input.address.country,
        lat: input.geo?.lat ?? null,
        lng: input.geo?.lng ?? null,
        isPublished: input.isPublished ?? false,
      },
      ...houseWithCount,
    });
    return this.toResponse(created);
  }

  async list(
    actor: { id: string; roles: Role[] },
    query: ListHousesQueryDto,
  ): Promise<Page<House>> {
    const isAdmin = actor.roles.includes('ADMIN');
    const where = {
      deletedAt: null,
      ...(isAdmin ? {} : { ownerId: actor.id }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' as const } },
          { city: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }),
      ...(query.isPublished !== undefined && { isPublished: query.isPublished }),
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
    const nextCursor = hasMore ? (items.at(-1)?.id ?? null) : null;

    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor,
    };
  }

  async getById(actor: { id: string; roles: Role[] }, id: string): Promise<House> {
    const row = await this.prisma.house.findUnique({
      where: { id },
      ...houseWithCount,
    });
    if (!row || row.deletedAt) throw this.notFound();
    if (!this.canRead(actor, row.ownerId)) throw this.notOwned();
    return this.toResponse(row);
  }

  async update(
    actor: { id: string; roles: Role[] },
    id: string,
    patch: UpdateHouseDto,
  ): Promise<House> {
    const existing = await this.prisma.house.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw this.notFound();
    if (!this.canMutate(actor, existing.ownerId)) throw this.notOwned();

    const updated = await this.prisma.house.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.isPublished !== undefined && { isPublished: patch.isPublished }),
        ...(patch.address && {
          addressLine1: patch.address.line1,
          addressLine2: patch.address.line2 ?? null,
          city: patch.address.city,
          state: patch.address.state ?? null,
          postalCode: patch.address.postalCode ?? null,
          country: patch.address.country,
        }),
        ...(patch.geo !== undefined && {
          lat: patch.geo?.lat ?? null,
          lng: patch.geo?.lng ?? null,
        }),
      },
      ...houseWithCount,
    });
    return this.toResponse(updated);
  }

  async softDelete(actor: { id: string; roles: Role[] }, id: string): Promise<void> {
    const existing = await this.prisma.house.findUnique({
      where: { id },
      include: { units: { where: { status: { not: 'VACANT' } } } },
    });
    if (!existing || existing.deletedAt) throw this.notFound();
    if (!this.canMutate(actor, existing.ownerId)) throw this.notOwned();

    if (existing.units.length > 0) {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.HOUSE_HAS_ACTIVE_UNITS,
        title: 'House has active units',
        detail: 'All units must be VACANT before deleting the house.',
      });
    }

    await this.prisma.house.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---- helpers --------------------------------------------------------

  private canRead(actor: { id: string; roles: Role[] }, ownerId: string): boolean {
    return actor.roles.includes('ADMIN') || actor.id === ownerId;
  }

  private canMutate(actor: { id: string; roles: Role[] }, ownerId: string): boolean {
    return actor.id === ownerId;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.HOUSE_NOT_FOUND,
      title: 'House not found',
    });
  }

  private notOwned(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.HOUSE_NOT_FOUND,
      title: 'House not found',
      detail: 'Hidden so we do not leak the existence of other owners’ houses.',
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
