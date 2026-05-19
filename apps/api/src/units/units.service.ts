import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, type Page, type Role, type Unit } from '@repo/shared';

import type { CreateUnitDto, ListUnitsQueryDto, UpdateUnitDto } from './dto/units.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type UnitRow = Prisma.UnitGetPayload<Record<string, never>>;

/**
 * Units service — mirrors HousesService. Authorization is layered: the parent
 * House must be readable/mutable by the actor, then unit operations apply.
 * `assertHouseAccess` is the single funnel — every public method calls it.
 *
 * Same "404 not 403" leakage policy: a non-owning actor sees houses.not_found
 * for both the parent house and any unit inside it, never confirming the
 * resource exists.
 */
@Injectable()
export class UnitsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async create(
    actor: { id: string; roles: Role[] },
    houseId: string,
    input: CreateUnitDto,
  ): Promise<Unit> {
    await this.assertHouseAccess(actor, houseId, 'mutate');

    try {
      const created = await this.prisma.unit.create({
        data: {
          houseId,
          label: input.label,
          status: input.status,
          floor: input.floor ?? null,
          sqm: input.sqm ?? null,
          bedrooms: input.bedrooms ?? null,
          bathrooms: input.bathrooms ?? null,
        },
      });
      return this.toResponse(created);
    } catch (err) {
      if (this.isUniqueViolation(err, ['houseId', 'label'])) throw this.labelTaken();
      throw err;
    }
  }

  async list(
    actor: { id: string; roles: Role[] },
    houseId: string,
    query: ListUnitsQueryDto,
  ): Promise<Page<Unit>> {
    await this.assertHouseAccess(actor, houseId, 'read');

    const where: Prisma.UnitWhereInput = {
      houseId,
      deletedAt: null,
      ...(query.status !== undefined && { status: query.status }),
    };

    const limit = query.limit;
    const findArgs: Prisma.UnitFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const rows = await this.prisma.unit.findMany(findArgs);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getById(actor: { id: string; roles: Role[] }, houseId: string, id: string): Promise<Unit> {
    await this.assertHouseAccess(actor, houseId, 'read');
    const row = await this.findOwnedUnit(houseId, id);
    return this.toResponse(row);
  }

  async update(
    actor: { id: string; roles: Role[] },
    houseId: string,
    id: string,
    patch: UpdateUnitDto,
  ): Promise<Unit> {
    await this.assertHouseAccess(actor, houseId, 'mutate');
    await this.findOwnedUnit(houseId, id);

    try {
      const updated = await this.prisma.unit.update({
        where: { id },
        data: {
          ...(patch.label !== undefined && { label: patch.label }),
          ...(patch.status !== undefined && { status: patch.status }),
          ...(patch.floor !== undefined && { floor: patch.floor ?? null }),
          ...(patch.sqm !== undefined && { sqm: patch.sqm ?? null }),
          ...(patch.bedrooms !== undefined && { bedrooms: patch.bedrooms ?? null }),
          ...(patch.bathrooms !== undefined && { bathrooms: patch.bathrooms ?? null }),
        },
      });
      return this.toResponse(updated);
    } catch (err) {
      if (this.isUniqueViolation(err, ['houseId', 'label'])) throw this.labelTaken();
      throw err;
    }
  }

  async softDelete(
    actor: { id: string; roles: Role[] },
    houseId: string,
    id: string,
  ): Promise<void> {
    await this.assertHouseAccess(actor, houseId, 'mutate');
    await this.findOwnedUnit(houseId, id);

    // Block delete if any non-ENDED lease exists. ENDED leases are historical
    // records and don't prevent unit cleanup.
    const activeLeaseCount = await this.prisma.lease.count({
      where: { unitId: id, status: { in: ['DRAFT', 'ACTIVE'] }, deletedAt: null },
    });
    if (activeLeaseCount > 0) {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.UNIT_HAS_ACTIVE_LEASE,
        title: 'Unit has active lease',
        detail: `Unit has ${activeLeaseCount} active or draft lease(s). End or delete them first.`,
      });
    }

    await this.prisma.unit.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---- helpers --------------------------------------------------------

  /**
   * Resolve the parent house and confirm the actor can act on it. ADMIN can
   * read but not mutate. Returns nothing — throws on failure. Always returns
   * houses.not_found (not 403) so we don't leak existence to non-owners.
   */
  private async assertHouseAccess(
    actor: { id: string; roles: Role[] },
    houseId: string,
    mode: 'read' | 'mutate',
  ): Promise<void> {
    const house = await this.prisma.house.findUnique({
      where: { id: houseId },
      select: { id: true, ownerId: true, deletedAt: true },
    });
    if (!house || house.deletedAt) throw this.houseNotFound();

    const isAdmin = actor.roles.includes('ADMIN');
    const isOwner = actor.id === house.ownerId;
    if (mode === 'read' ? !(isAdmin || isOwner) : !isOwner) throw this.houseNotFound();
  }

  private async findOwnedUnit(houseId: string, id: string): Promise<UnitRow> {
    const row = await this.prisma.unit.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.houseId !== houseId) throw this.unitNotFound();
    return row;
  }

  private isUniqueViolation(err: unknown, fields: string[]): boolean {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (err.code !== 'P2002') return false;
    const target = (err.meta?.target as string[] | undefined) ?? [];
    return fields.every((f) => target.includes(f));
  }

  private houseNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.HOUSE_NOT_FOUND,
      title: 'House not found',
    });
  }

  private unitNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.UNIT_NOT_FOUND,
      title: 'Unit not found',
    });
  }

  private labelTaken(): ProblemError {
    return new ProblemError({
      status: 409,
      type: ErrorCodes.UNIT_LABEL_TAKEN,
      title: 'Unit label already in use',
      detail: 'Another unit in this house already uses that label.',
    });
  }

  private toResponse(row: UnitRow): Unit {
    return {
      id: row.id,
      houseId: row.houseId,
      label: row.label,
      status: row.status,
      floor: row.floor,
      sqm: row.sqm,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
