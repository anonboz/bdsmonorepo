import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type Page,
  type PartnerProfile,
  type PartnerSummary,
  type Service,
} from '@repo/shared';

import type {
  CreateServiceDto,
  ListPartnersQueryDto,
  UpdateServiceDto,
  UpsertPartnerProfileDto,
} from './dto/partners.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const PROFILE_WITH_USER = {
  include: {
    user: {
      select: { displayName: true, email: true, isSuspended: true, deletedAt: true },
    },
  },
} satisfies Prisma.PartnerProfileDefaultArgs;

type ProfileRow = Prisma.PartnerProfileGetPayload<typeof PROFILE_WITH_USER>;
type ServiceRow = Prisma.ServiceGetPayload<Record<string, never>>;

/**
 * Partner marketplace catalog service.
 *
 * Authorization:
 * - **PARTNER**: manages own profile (1:1 with User) + own services.
 * - **OWNER / ADMIN**: read-only discovery via `listPublic` + `getPublic`.
 * - **TENANT**: no access in this slice.
 */
@Injectable()
export class PartnersService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  // ---- Partner-scoped (own profile) --------------------------------

  async getOwnProfile(userId: string): Promise<PartnerProfile> {
    const row = await this.prisma.partnerProfile.findUnique({
      where: { userId },
      ...PROFILE_WITH_USER,
    });
    if (!row || row.deletedAt) {
      throw this.profileNotFound();
    }
    return this.toProfile(row);
  }

  /**
   * PUT-style upsert. Creates the row on first call, updates on
   * subsequent calls. Idempotent and safe to retry.
   */
  async upsertOwnProfile(userId: string, input: UpsertPartnerProfileDto): Promise<PartnerProfile> {
    const row = await this.prisma.partnerProfile.upsert({
      where: { userId },
      create: {
        userId,
        businessName: input.businessName,
        bio: input.bio ?? null,
        serviceArea: input.serviceArea ?? null,
      },
      update: {
        businessName: input.businessName,
        bio: input.bio ?? null,
        serviceArea: input.serviceArea ?? null,
      },
      ...PROFILE_WITH_USER,
    });
    return this.toProfile(row);
  }

  // ---- Partner-scoped (own services) -------------------------------

  async listOwnServices(userId: string): Promise<Page<Service>> {
    const profile = await this.assertOwnProfile(userId);
    const rows = await this.prisma.service.findMany({
      where: { partnerId: profile.id, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: rows.map((r) => this.toService(r)),
      nextCursor: null,
    };
  }

  async createOwnService(userId: string, input: CreateServiceDto): Promise<Service> {
    const profile = await this.assertOwnProfile(userId);
    const row = await this.prisma.service.create({
      data: {
        partnerId: profile.id,
        name: input.name,
        description: input.description ?? null,
        basePrice: input.basePrice,
        currency: input.currency,
        isActive: input.isActive ?? true,
      },
    });
    return this.toService(row);
  }

  async getOwnService(userId: string, id: string): Promise<Service> {
    const profile = await this.assertOwnProfile(userId);
    const row = await this.findOwnedServiceOrFail(profile.id, id);
    return this.toService(row);
  }

  async updateOwnService(userId: string, id: string, patch: UpdateServiceDto): Promise<Service> {
    const profile = await this.assertOwnProfile(userId);
    await this.findOwnedServiceOrFail(profile.id, id);
    const row = await this.prisma.service.update({
      where: { id },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.description !== undefined && { description: patch.description ?? null }),
        ...(patch.basePrice !== undefined && { basePrice: patch.basePrice }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      },
    });
    return this.toService(row);
  }

  async deleteOwnService(userId: string, id: string): Promise<void> {
    const profile = await this.assertOwnProfile(userId);
    await this.findOwnedServiceOrFail(profile.id, id);
    await this.prisma.service.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ---- Owner-scoped (discovery) ------------------------------------

  async listPublic(query: ListPartnersQueryDto): Promise<Page<PartnerSummary>> {
    const where: Prisma.PartnerProfileWhereInput = {
      deletedAt: null,
      user: { isSuspended: false, deletedAt: null },
      ...(query.q && {
        OR: [
          { businessName: { contains: query.q, mode: 'insensitive' as const } },
          { serviceArea: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }),
    };

    const limit = query.limit;
    const findArgs: Prisma.PartnerProfileFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...PROFILE_WITH_USER,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.partnerProfile.findMany(findArgs)) as ProfileRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    const partnerIds = items.map((r) => r.id);
    const services =
      partnerIds.length === 0
        ? []
        : await this.prisma.service.findMany({
            where: { partnerId: { in: partnerIds }, deletedAt: null, isActive: true },
            orderBy: [{ createdAt: 'desc' }],
          });
    const byPartner = new Map<string, Service[]>();
    for (const s of services) {
      const list = byPartner.get(s.partnerId) ?? [];
      list.push(this.toService(s));
      byPartner.set(s.partnerId, list);
    }

    const ratings = await this.aggregateRatings(items.map((r) => r.userId));

    const summaries: PartnerSummary[] = items.map((r) => {
      const agg = ratings.get(r.userId);
      return {
        ...this.toProfile(r),
        activeServices: byPartner.get(r.id) ?? [],
        ratingAverage: agg?.average ?? null,
        ratingCount: agg?.count ?? 0,
      };
    });

    // Rating-aware sort within the page. Cross-page ordering still uses
    // createdAt — acceptable for v1 since the directory is small.
    summaries.sort((a, b) => {
      const aAvg = a.ratingAverage;
      const bAvg = b.ratingAverage;
      if (aAvg !== bAvg) {
        if (aAvg === null) return 1;
        if (bAvg === null) return -1;
        return bAvg - aAvg;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

    return {
      items: summaries,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getPublic(id: string): Promise<PartnerSummary> {
    const row = await this.prisma.partnerProfile.findUnique({
      where: { id },
      ...PROFILE_WITH_USER,
    });
    if (!row || row.deletedAt || !row.user || row.user.deletedAt || row.user.isSuspended) {
      throw this.profileNotFound();
    }
    const services = await this.prisma.service.findMany({
      where: { partnerId: id, deletedAt: null, isActive: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    const ratings = await this.aggregateRatings([row.userId]);
    const agg = ratings.get(row.userId);
    return {
      ...this.toProfile(row),
      activeServices: services.map((s) => this.toService(s)),
      ratingAverage: agg?.average ?? null,
      ratingCount: agg?.count ?? 0,
    };
  }

  /**
   * Per-user (rated-id) rating aggregate. Returns a map so callers can
   * look up by userId without re-scanning. Empty input → empty map.
   */
  private async aggregateRatings(
    userIds: string[],
  ): Promise<Map<string, { average: number; count: number }>> {
    if (userIds.length === 0) return new Map();
    const grouped = await this.prisma.jobRating.groupBy({
      by: ['ratedId'],
      where: { ratedId: { in: userIds } },
      _avg: { score: true },
      _count: { score: true },
    });
    const map = new Map<string, { average: number; count: number }>();
    for (const g of grouped) {
      const count = g._count.score ?? 0;
      if (count === 0) continue;
      const avg = g._avg.score;
      if (avg === null || avg === undefined) continue;
      map.set(g.ratedId, { average: avg, count });
    }
    return map;
  }

  // ---- helpers -----------------------------------------------------

  private async assertOwnProfile(userId: string): Promise<{ id: string }> {
    const row = await this.prisma.partnerProfile.findUnique({
      where: { userId },
      select: { id: true, deletedAt: true },
    });
    if (!row || row.deletedAt) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PARTNER_PROFILE_NOT_FOUND,
        title: 'Partner profile not found',
        detail: 'Publish your partner profile before managing services.',
      });
    }
    return { id: row.id };
  }

  private async findOwnedServiceOrFail(partnerId: string, id: string): Promise<ServiceRow> {
    const row = await this.prisma.service.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.partnerId !== partnerId) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.PARTNER_SERVICE_NOT_FOUND,
        title: 'Service not found',
      });
    }
    return row;
  }

  private profileNotFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.PARTNER_PROFILE_NOT_FOUND,
      title: 'Partner profile not found',
    });
  }

  private toProfile(row: ProfileRow): PartnerProfile {
    return {
      id: row.id,
      userId: row.userId,
      displayName: row.user.displayName,
      email: row.user.email,
      businessName: row.businessName,
      bio: row.bio,
      serviceArea: row.serviceArea,
      kycStatus: row.kycStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toService(row: ServiceRow): Service {
    return {
      id: row.id,
      partnerId: row.partnerId,
      name: row.name,
      description: row.description,
      basePrice: row.basePrice,
      currency: row.currency,
      isActive: row.isActive,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}
