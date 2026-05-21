import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationTopic,
  type Page,
  type Ticket,
  type TicketStatus,
} from '@repo/shared';

import type {
  CreateTicketDto,
  ListTicketsQueryDto,
  TransitionTicketDto,
} from './dto/tickets.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const TICKET_WITH_RELATIONS = {
  include: {
    reporter: { select: { displayName: true } },
    lease: {
      select: { ownerId: true, tenantId: true, unitId: true, unit: { select: { houseId: true } } },
    },
  },
} satisfies Prisma.TicketDefaultArgs;

type TicketRow = Prisma.TicketGetPayload<typeof TICKET_WITH_RELATIONS>;

const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Allowed state transitions for a ticket. Source of truth for both the
 * service guard and the UI's button visibility.
 *
 * Tenant-only transition: REOPENED (within 7d of resolvedAt/closedAt).
 * Owner-only transitions: ACKNOWLEDGED, IN_PROGRESS, RESOLVED, CLOSED.
 */
const ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED', 'CLOSED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
};

type Actor = 'OWNER' | 'TENANT';
const TRANSITION_ACTOR: Record<TicketStatus, Actor> = {
  OPEN: 'OWNER',
  ACKNOWLEDGED: 'OWNER',
  IN_PROGRESS: 'OWNER',
  RESOLVED: 'OWNER',
  CLOSED: 'OWNER',
  REOPENED: 'TENANT',
};

/**
 * Tickets service.
 *
 * Multi-party authorization:
 * - **TENANT** (named on the lease): creates tickets on their leases,
 *   reads their own, transitions only `REOPENED` within the 7d window.
 * - **OWNER** (of the parent house): queue across all owned houses,
 *   all transitions except REOPENED.
 * - **ADMIN**: read-any. No transitions in this slice — moderation lands
 *   in a later phase.
 */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Tenant-scoped ------------------------------------------------

  async createForTenant(tenantId: string, input: CreateTicketDto): Promise<Ticket> {
    const lease = await this.prisma.lease.findUnique({
      where: { id: input.leaseId },
      select: { id: true, tenantId: true, ownerId: true, status: true, deletedAt: true },
    });
    if (!lease || lease.deletedAt || lease.tenantId !== tenantId) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.TICKET_LEASE_INVALID,
        title: 'Lease not found',
      });
    }

    const { created, enqueue } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.create({
        data: {
          leaseId: input.leaseId,
          reporterId: tenantId,
          assigneeId: lease.ownerId,
          category: input.category,
          status: 'OPEN',
          title: input.title,
          body: input.body,
        },
        ...TICKET_WITH_RELATIONS,
      });
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.TICKET_OPENED,
        recipientId: lease.ownerId,
        data: {
          ticketId: row.id,
          ticketTitle: row.title,
          tenantName: row.reporter.displayName,
          category: row.category,
        },
      });
      return { created: row, enqueue: dispatch.enqueue };
    });
    await enqueue();
    return this.toResponse(created);
  }

  async listForTenant(tenantId: string, query: ListTicketsQueryDto): Promise<Page<Ticket>> {
    return this.paginate(
      {
        reporterId: tenantId,
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
        ...(query.category !== undefined && { category: query.category }),
      },
      query,
    );
  }

  async getForTenant(tenantId: string, id: string): Promise<Ticket> {
    const row = await this.prisma.ticket.findUnique({ where: { id }, ...TICKET_WITH_RELATIONS });
    if (!row || row.deletedAt || row.reporterId !== tenantId) throw this.notFound();
    return this.toResponse(row);
  }

  async tenantReopen(tenantId: string, id: string): Promise<Ticket> {
    const existing = await this.findOwned(id);
    if (existing.reporterId !== tenantId) throw this.notFound();

    if (existing.status !== 'RESOLVED' && existing.status !== 'CLOSED') {
      throw this.invalidTransition(existing.status, 'REOPENED');
    }

    const reference = existing.closedAt ?? existing.resolvedAt;
    if (!reference || Date.now() - reference.getTime() > REOPEN_WINDOW_MS) {
      throw new ProblemError({
        status: 409,
        type: ErrorCodes.TICKET_REOPEN_WINDOW_EXPIRED,
        title: 'Reopen window expired',
        detail: 'Tickets can be reopened within 7 days of resolution or closure.',
      });
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'REOPENED', resolvedAt: null, closedAt: null },
      ...TICKET_WITH_RELATIONS,
    });
    return this.toResponse(updated);
  }

  // ---- Owner-scoped -------------------------------------------------

  async listForOwner(ownerId: string, query: ListTicketsQueryDto): Promise<Page<Ticket>> {
    return this.paginate(
      {
        lease: { ownerId, deletedAt: null },
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
        ...(query.category !== undefined && { category: query.category }),
      },
      query,
    );
  }

  async getForOwner(ownerId: string, id: string): Promise<Ticket> {
    const row = await this.prisma.ticket.findUnique({ where: { id }, ...TICKET_WITH_RELATIONS });
    if (!row || row.deletedAt || row.lease.ownerId !== ownerId) throw this.notFound();
    return this.toResponse(row);
  }

  async ownerTransition(ownerId: string, id: string, input: TransitionTicketDto): Promise<Ticket> {
    const existing = await this.findOwned(id);
    if (existing.lease.ownerId !== ownerId) throw this.notFound();
    if (TRANSITION_ACTOR[input.to] !== 'OWNER') {
      throw new ProblemError({
        status: 403,
        type: ErrorCodes.AUTH_ROLE_MISMATCH,
        title: 'Only the tenant can reopen a ticket',
      });
    }
    if (!ALLOWED_TRANSITIONS[existing.status].includes(input.to)) {
      throw this.invalidTransition(existing.status, input.to);
    }

    const now = new Date();
    const { updated, enqueue } = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id },
        data: {
          status: input.to,
          ...(input.to === 'RESOLVED' && { resolvedAt: now }),
          ...(input.to === 'CLOSED' && { closedAt: now }),
        },
        ...TICKET_WITH_RELATIONS,
      });
      // Only fire on the RESOLVED edge; CLOSED/IN_PROGRESS stay silent.
      // The tenant sees status changes in-app — email only for the one
      // transition they care most about ("did the landlord fix it?").
      if (input.to !== 'RESOLVED') return { updated: row, enqueue: null };
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.TICKET_RESOLVED,
        recipientId: row.reporterId,
        data: {
          ticketId: row.id,
          ticketTitle: row.title,
        },
      });
      return { updated: row, enqueue: dispatch.enqueue };
    });
    if (enqueue) await enqueue();
    return this.toResponse(updated);
  }

  // ---- Admin-scoped -------------------------------------------------

  async listAll(query: ListTicketsQueryDto): Promise<Page<Ticket>> {
    return this.paginate(
      {
        deletedAt: null,
        ...(query.status !== undefined && { status: query.status }),
        ...(query.category !== undefined && { category: query.category }),
      },
      query,
    );
  }

  async getAny(id: string): Promise<Ticket> {
    const row = await this.prisma.ticket.findUnique({ where: { id }, ...TICKET_WITH_RELATIONS });
    if (!row || row.deletedAt) throw this.notFound();
    return this.toResponse(row);
  }

  // ---- helpers ------------------------------------------------------

  private async paginate(
    where: Prisma.TicketWhereInput,
    query: ListTicketsQueryDto,
  ): Promise<Page<Ticket>> {
    const limit = query.limit;
    const findArgs: Prisma.TicketFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...TICKET_WITH_RELATIONS,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.ticket.findMany(findArgs)) as TicketRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async findOwned(id: string): Promise<TicketRow> {
    const row = await this.prisma.ticket.findUnique({ where: { id }, ...TICKET_WITH_RELATIONS });
    if (!row || row.deletedAt) throw this.notFound();
    return row;
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.TICKET_NOT_FOUND,
      title: 'Ticket not found',
    });
  }

  private invalidTransition(from: string, to: TicketStatus): ProblemError {
    return new ProblemError({
      status: 422,
      type: ErrorCodes.TICKET_INVALID_TRANSITION,
      title: 'Invalid ticket transition',
      detail: `Cannot move ticket from ${from} to ${to}.`,
    });
  }

  private toResponse(row: TicketRow): Ticket {
    return {
      id: row.id,
      leaseId: row.leaseId,
      unitId: row.lease.unitId,
      houseId: row.lease.unit.houseId,
      reporterId: row.reporterId,
      reporterName: row.reporter.displayName,
      assigneeId: row.assigneeId,
      category: row.category,
      status: row.status,
      title: row.title,
      body: row.body,
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Exported for the UI/spec — same source of truth the service uses.
 */
export const TICKET_ALLOWED_TRANSITIONS = ALLOWED_TRANSITIONS;
export const TICKET_TRANSITION_ACTOR = TRANSITION_ACTOR;
export const TICKET_REOPEN_WINDOW_MS = REOPEN_WINDOW_MS;
