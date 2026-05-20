import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  type Campaign,
  type CampaignStatus,
  ErrorCodes,
  type Page,
  type PublicCampaign,
  type Role,
} from '@repo/shared';

import type {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  TransitionCampaignDto,
  UpdateCampaignDto,
} from './dto/campaigns.dto.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { RequestContext } from '../common/audit/request-context.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const CAMPAIGN_WITH_UNIT = {
  include: { unit: { select: { houseId: true } } },
} satisfies Prisma.CampaignDefaultArgs;

type CampaignRow = Prisma.CampaignGetPayload<typeof CAMPAIGN_WITH_UNIT>;

/**
 * Shape needed by the public projection. Joins house + unit so listing
 * cards render without follow-up queries.
 */
const CAMPAIGN_FOR_PUBLIC = {
  include: {
    unit: {
      select: {
        label: true,
        bedrooms: true,
        bathrooms: true,
        sqm: true,
        houseId: true,
        house: {
          select: { name: true, city: true, country: true, moderationStatus: true },
        },
      },
    },
  },
} satisfies Prisma.CampaignDefaultArgs;

type PublicCampaignRow = Prisma.CampaignGetPayload<typeof CAMPAIGN_FOR_PUBLIC>;

/**
 * Owner-side transitions only. Admin transitions (PENDING → LIVE /
 * REJECTED) land in 4.2 in a separate code path so the permission
 * gate stays trivial here.
 */
const OWNER_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ['PENDING'],
  PENDING: ['DRAFT'],
  LIVE: ['CLOSED'],
  CLOSED: [],
  // 4.2: rejected campaigns can be edited + re-submitted without
  // recreating from scratch.
  REJECTED: ['PENDING'],
  EXPIRED: [],
};

/** Statuses where PATCH is allowed. */
const EDITABLE_STATUSES: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>([
  'DRAFT',
  'REJECTED',
]);

const ACTION_FOR_TRANSITION: Record<CampaignStatus, string> = {
  PENDING: 'campaign.submit',
  DRAFT: 'campaign.withdraw',
  CLOSED: 'campaign.close',
  LIVE: 'campaign.publish', // admin-only path; included for completeness
  REJECTED: 'campaign.reject',
  EXPIRED: 'campaign.expire',
};

/**
 * Campaigns service.
 *
 * Authorization (4.1 scope):
 * - **Owner** of the parent house — full CRUD + owner-side transitions
 *   on campaigns under their own units. Cross-owner access → 404 to
 *   match the existence-hiding pattern from `leases` / `houses`.
 * - **Admin** — read any (mutations land in 4.2).
 * - **Tenant / Partner** — no access yet.
 */
@Injectable()
export class CampaignsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
  ) {}

  // ---- Owner-scoped (nested under unit) -----------------------------

  async createForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    input: CreateCampaignDto,
  ): Promise<Campaign> {
    const { house } = await this.assertOwnerOfUnit(actor, houseId, unitId);
    const created = await this.prisma.campaign.create({
      data: {
        unitId,
        ownerId: house.ownerId,
        title: input.title,
        body: input.body,
        price: input.price,
        currency: input.currency,
        photos: input.photos ?? [],
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        status: 'DRAFT',
      },
      ...CAMPAIGN_WITH_UNIT,
    });
    return this.toResponse(created);
  }

  async listForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    query: ListCampaignsQueryDto,
  ): Promise<Page<Campaign>> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    return this.paginate(
      {
        unitId,
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
      },
      query,
    );
  }

  async getForUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
  ): Promise<Campaign> {
    await this.assertOwnerOrAdminOfUnit(actor, houseId, unitId);
    const row = await this.findCampaignOnUnit(id, unitId);
    return this.toResponse(row);
  }

  async updateDraft(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    patch: UpdateCampaignDto,
  ): Promise<Campaign> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);
    if (!EDITABLE_STATUSES.has(existing.status)) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.CAMPAIGN_NOT_DRAFT,
        title: 'Campaign is not editable',
        detail: 'Only DRAFT or REJECTED campaigns can be edited.',
      });
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.body !== undefined && { body: patch.body }),
        ...(patch.price !== undefined && { price: patch.price }),
        ...(patch.currency !== undefined && { currency: patch.currency }),
        ...(patch.photos !== undefined && { photos: patch.photos }),
        ...(patch.expiresAt !== undefined && {
          expiresAt: patch.expiresAt ? new Date(patch.expiresAt) : null,
        }),
      },
      ...CAMPAIGN_WITH_UNIT,
    });
    return this.toResponse(updated);
  }

  async transition(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
    input: TransitionCampaignDto,
    ctx: RequestContext,
  ): Promise<Campaign> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);

    if (!OWNER_TRANSITIONS[existing.status].includes(input.to)) {
      throw this.invalidTransition(existing.status, input.to);
    }

    // Submitting: enforce one LIVE per unit and that the unit is VACANT.
    if (input.to === 'PENDING') {
      await this.assertUnitVacantForSubmit(unitId, id);
    }

    const previousStatus = existing.status;
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.campaign.update({
        where: { id },
        data: {
          status: input.to,
          // Re-submitting (DRAFT or REJECTED → PENDING) starts a fresh
          // review cycle — clear the stale moderation snapshot so the
          // UI doesn't display the previous rejection reason.
          ...(input.to === 'PENDING' && {
            moderationReason: null,
            moderationDecidedAt: null,
            moderationDecidedBy: null,
          }),
        },
        ...CAMPAIGN_WITH_UNIT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: ACTION_FOR_TRANSITION[input.to],
        target: `Campaign:${id}`,
        meta: { previousStatus, unitId, houseId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return row;
    });
    return this.toResponse(updated);
  }

  // ---- Admin-scoped moderation --------------------------------------

  async listAsAdmin(query: {
    limit: number;
    sort: 'asc' | 'desc';
    cursor?: string;
    status?: CampaignStatus;
    ownerId?: string;
    q?: string;
  }): Promise<Page<Campaign>> {
    const where: Prisma.CampaignWhereInput = {
      deletedAt: null,
      ...(query.status !== undefined && { status: query.status }),
      ...(query.ownerId !== undefined && { ownerId: query.ownerId }),
      ...(query.q && {
        OR: [
          { title: { contains: query.q, mode: 'insensitive' as const } },
          { unit: { house: { city: { contains: query.q, mode: 'insensitive' as const } } } },
        ],
      }),
    };
    return this.paginate(where, query);
  }

  async approveAsAdmin(id: string, ctx: RequestContext): Promise<Campaign> {
    const existing = await this.loadForAdminOrFail(id);
    if (existing.status !== 'PENDING') throw this.notPendingForAdmin();

    const previousStatus = existing.status;
    const decidedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: 'LIVE',
          publishedAt: decidedAt,
          moderationReason: null,
          moderationDecidedAt: decidedAt,
          moderationDecidedBy: ctx.actorId,
        },
        ...CAMPAIGN_WITH_UNIT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'campaign.approve',
        target: `Campaign:${id}`,
        meta: { previousStatus, unitId: existing.unitId, houseId: existing.unit.houseId },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async rejectAsAdmin(
    id: string,
    input: { reason: string },
    ctx: RequestContext,
  ): Promise<Campaign> {
    const existing = await this.loadForAdminOrFail(id);
    if (existing.status !== 'PENDING') throw this.notPendingForAdmin();

    const previousStatus = existing.status;
    const decidedAt = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.campaign.update({
        where: { id },
        data: {
          status: 'REJECTED',
          moderationReason: input.reason,
          moderationDecidedAt: decidedAt,
          moderationDecidedBy: ctx.actorId,
        },
        ...CAMPAIGN_WITH_UNIT,
      });
      await this.audit.write(tx, {
        actorId: ctx.actorId,
        action: 'campaign.reject',
        target: `Campaign:${id}`,
        meta: {
          previousStatus,
          reason: input.reason,
          unitId: existing.unitId,
          houseId: existing.unit.houseId,
        },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return updated;
    });
    return this.toResponse(row);
  }

  async softDelete(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
    id: string,
  ): Promise<void> {
    await this.assertOwnerOfUnit(actor, houseId, unitId);
    const existing = await this.findCampaignOnUnit(id, unitId);
    if (existing.status !== 'DRAFT' && existing.status !== 'CLOSED') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.CAMPAIGN_INVALID_TRANSITION,
        title: 'Cannot delete in current state',
        detail: 'Only DRAFT or CLOSED campaigns can be deleted.',
      });
    }
    await this.prisma.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ---- Admin-scoped (read-any) --------------------------------------

  async getAny(id: string): Promise<Campaign> {
    const row = await this.loadForAdminOrFail(id);
    return this.toResponse(row);
  }

  // ---- Public (no auth) ---------------------------------------------

  async listPublic(query: {
    limit: number;
    sort: 'asc' | 'desc';
    cursor?: string;
    q?: string;
    city?: string;
    country?: string;
    minPrice?: number;
    maxPrice?: number;
  }): Promise<Page<PublicCampaign>> {
    // Clamp the public page size — the authenticated lists allow 100 but
    // anonymous traffic gets a lower ceiling to make abuse less attractive.
    const limit = Math.min(query.limit, 50);
    const where: Prisma.CampaignWhereInput = {
      ...publicVisibleWhere(new Date()),
      ...(query.q && { title: { contains: query.q, mode: 'insensitive' as const } }),
      ...(query.city && {
        unit: { house: { city: { equals: query.city, mode: 'insensitive' as const } } },
      }),
      ...(query.country && { unit: { house: { country: query.country } } }),
      ...(query.minPrice !== undefined && { price: { gte: query.minPrice } }),
      ...(query.maxPrice !== undefined && {
        price: {
          ...(query.minPrice !== undefined && { gte: query.minPrice }),
          lte: query.maxPrice,
        },
      }),
    };

    const findArgs: Prisma.CampaignFindManyArgs = {
      where,
      orderBy: [{ publishedAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...CAMPAIGN_FOR_PUBLIC,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.campaign.findMany(findArgs)) as PublicCampaignRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toPublic(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getPublic(id: string): Promise<PublicCampaign> {
    const row = await this.prisma.campaign.findUnique({
      where: { id },
      ...CAMPAIGN_FOR_PUBLIC,
    });
    if (!row || !this.isPubliclyVisible(row, new Date())) throw this.notFound();
    return this.toPublic(row);
  }

  // ---- Sweeper (worker-facing) --------------------------------------

  /**
   * Flip every `LIVE` campaign whose `expiresAt` has passed to `EXPIRED`.
   * Each row's status flip and audit write commit (or roll back)
   * together. Returns how many rows were expired.
   *
   * Called from the BullMQ sweeper; safe to invoke from a unit spec.
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.campaign.findMany({
      where: { status: 'LIVE', deletedAt: null, expiresAt: { lt: now, not: null } },
      select: { id: true, expiresAt: true, unitId: true, unit: { select: { houseId: true } } },
    });
    let expired = 0;
    for (const row of due) {
      await this.prisma.$transaction(async (tx) => {
        await tx.campaign.update({
          where: { id: row.id },
          data: { status: 'EXPIRED' },
        });
        await this.audit.write(tx, {
          actorId: null,
          action: 'campaign.expire',
          target: `Campaign:${row.id}`,
          meta: {
            previousStatus: 'LIVE',
            expiresAt: row.expiresAt?.toISOString() ?? null,
            unitId: row.unitId,
            houseId: row.unit.houseId,
            source: 'sweeper',
          },
        });
      });
      expired += 1;
    }
    return expired;
  }

  // ---- helpers ------------------------------------------------------

  private async paginate(
    where: Prisma.CampaignWhereInput,
    query: ListCampaignsQueryDto,
  ): Promise<Page<Campaign>> {
    const limit = query.limit;
    const findArgs: Prisma.CampaignFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...CAMPAIGN_WITH_UNIT,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.campaign.findMany(findArgs)) as CampaignRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async assertUnitVacantForSubmit(unitId: string, ignoreCampaignId: string): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { status: true, deletedAt: true },
    });
    if (!unit || unit.deletedAt || unit.status !== 'VACANT') {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.CAMPAIGN_UNIT_NOT_VACANT,
        title: 'Unit is not vacant',
        detail: 'End or terminate the active lease before submitting a campaign.',
      });
    }
    const live = await this.prisma.campaign.count({
      where: { unitId, status: 'LIVE', deletedAt: null, NOT: { id: ignoreCampaignId } },
    });
    if (live > 0) {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.CAMPAIGN_UNIT_NOT_VACANT,
        title: 'Unit already has a live campaign',
        detail: 'Close the live campaign before submitting another for the same unit.',
      });
    }
  }

  private async assertOwnerOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<{ house: { id: string; ownerId: string }; unit: { id: string; houseId: string } }> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { id: true, ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    if (actor.id !== unit.house.ownerId) throw this.notFound();
    return {
      house: { id: unit.house.id, ownerId: unit.house.ownerId },
      unit: { id: unit.id, houseId: unit.houseId },
    };
  }

  private async assertOwnerOrAdminOfUnit(
    actor: { id: string; roles: Role[] },
    houseId: string,
    unitId: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        houseId: true,
        deletedAt: true,
        house: { select: { ownerId: true, deletedAt: true } },
      },
    });
    if (
      !unit ||
      unit.deletedAt ||
      unit.houseId !== houseId ||
      !unit.house ||
      unit.house.deletedAt
    ) {
      throw this.notFound();
    }
    const isAdmin = actor.roles.includes('ADMIN');
    if (!isAdmin && actor.id !== unit.house.ownerId) throw this.notFound();
  }

  private async findCampaignOnUnit(id: string, unitId: string): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findUnique({ where: { id }, ...CAMPAIGN_WITH_UNIT });
    if (!row || row.deletedAt || row.unitId !== unitId) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.CAMPAIGN_NOT_FOUND,
      title: 'Campaign not found',
    });
  }

  private isPubliclyVisible(row: PublicCampaignRow, now: Date): boolean {
    if (row.deletedAt) return false;
    if (row.status !== 'LIVE') return false;
    if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
    if (row.unit.house.moderationStatus === 'REJECTED') return false;
    return true;
  }

  private toPublic(row: PublicCampaignRow): PublicCampaign {
    return {
      id: row.id,
      ownerId: row.ownerId,
      unitId: row.unitId,
      houseId: row.unit.houseId,
      title: row.title,
      body: row.body,
      price: row.price,
      currency: row.currency,
      photos: row.photos,
      // publishedAt is non-null in this projection — only LIVE rows reach it.
      publishedAt: row.publishedAt!.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      house: {
        name: row.unit.house.name,
        city: row.unit.house.city,
        country: row.unit.house.country,
      },
      unit: {
        label: row.unit.label,
        bedrooms: row.unit.bedrooms,
        bathrooms: row.unit.bathrooms,
        sqm: row.unit.sqm,
      },
    };
  }

  private async loadForAdminOrFail(id: string): Promise<CampaignRow> {
    const row = await this.prisma.campaign.findUnique({ where: { id }, ...CAMPAIGN_WITH_UNIT });
    if (!row || row.deletedAt) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.ADMIN_CAMPAIGN_NOT_FOUND,
        title: 'Campaign not found',
      });
    }
    return row;
  }

  private notPendingForAdmin(): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.ADMIN_CAMPAIGN_NOT_PENDING,
      title: 'Campaign is not pending review',
      detail: 'Only PENDING campaigns can be approved or rejected.',
    });
  }

  private invalidTransition(from: CampaignStatus, to: CampaignStatus): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.CAMPAIGN_INVALID_TRANSITION,
      title: 'Invalid campaign transition',
      detail: `Cannot move campaign from ${from} to ${to}.`,
    });
  }

  private toResponse(row: CampaignRow): Campaign {
    return {
      id: row.id,
      ownerId: row.ownerId,
      unitId: row.unitId,
      houseId: row.unit.houseId,
      title: row.title,
      body: row.body,
      price: row.price,
      currency: row.currency,
      photos: row.photos,
      status: row.status,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      moderationReason: row.moderationReason,
      moderationDecidedAt: row.moderationDecidedAt ? row.moderationDecidedAt.toISOString() : null,
      moderationDecidedBy: row.moderationDecidedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    };
  }
}

export const CAMPAIGN_OWNER_TRANSITIONS = OWNER_TRANSITIONS;

/**
 * The visibility filter used by every public read. Exported so the
 * sweeper + a future feed-only controller can share one definition.
 */
export function publicVisibleWhere(now: Date): Prisma.CampaignWhereInput {
  return {
    status: 'LIVE',
    deletedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    // REJECTED-house takedown: skip the unit's parent if admin has
    // hard-rejected the house. FLAGGED still shows.
    unit: { house: { moderationStatus: { not: 'REJECTED' } } },
  };
}
