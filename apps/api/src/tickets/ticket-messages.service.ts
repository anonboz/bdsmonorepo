import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  type Page,
  type TicketMessage,
  type TicketMessageAuthorRole,
} from '@repo/shared';

import type {
  CreateTicketMessageDto,
  ListTicketMessagesQueryDto,
} from './dto/ticket-messages.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

const MESSAGE_WITH_AUTHOR = {
  include: { author: { select: { displayName: true } } },
} satisfies Prisma.TicketMessageDefaultArgs;

type MessageRow = Prisma.TicketMessageGetPayload<typeof MESSAGE_WITH_AUTHOR>;

/**
 * Threads can keep accepting messages until 7 days after closure / resolution
 * — same window the tenant has to reopen. After that, the conversation locks
 * so disputes about an old ticket can't be muddied with new chatter.
 */
const POST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ticket message thread.
 *
 * - TENANT (the reporter on the ticket) reads + posts.
 * - OWNER (of the lease's house) reads + posts.
 * - ADMIN reads any thread but does NOT post — admins arbitrate via
 *   audit log, not by joining the conversation. Enforced by only mounting
 *   the GET on the admin controller.
 */
@Injectable()
export class TicketMessagesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  // ---- Tenant -------------------------------------------------------

  async listForTenant(
    tenantId: string,
    ticketId: string,
    query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    await this.assertTenantParticipant(tenantId, ticketId);
    return this.paginate(ticketId, query);
  }

  async postForTenant(
    tenantId: string,
    tenantName: string,
    ticketId: string,
    input: CreateTicketMessageDto,
  ): Promise<TicketMessage> {
    const ticket = await this.assertTenantParticipant(tenantId, ticketId);
    this.assertThreadOpen(ticket);
    return this.append(ticketId, tenantId, tenantName, 'TENANT', input.body);
  }

  // ---- Owner --------------------------------------------------------

  async listForOwner(
    ownerId: string,
    ticketId: string,
    query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    await this.assertOwnerParticipant(ownerId, ticketId);
    return this.paginate(ticketId, query);
  }

  async postForOwner(
    ownerId: string,
    ownerName: string,
    ticketId: string,
    input: CreateTicketMessageDto,
  ): Promise<TicketMessage> {
    const ticket = await this.assertOwnerParticipant(ownerId, ticketId);
    this.assertThreadOpen(ticket);
    return this.append(ticketId, ownerId, ownerName, 'OWNER', input.body);
  }

  // ---- Admin --------------------------------------------------------

  async listForAdmin(
    ticketId: string,
    query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    await this.loadTicketOrFail(ticketId);
    return this.paginate(ticketId, query);
  }

  // ---- helpers ------------------------------------------------------

  private async append(
    ticketId: string,
    authorId: string,
    authorName: string,
    authorRole: TicketMessageAuthorRole,
    body: string,
  ): Promise<TicketMessage> {
    const created = await this.prisma.ticketMessage.create({
      data: { ticketId, authorId, authorRole, body },
    });
    return {
      id: created.id,
      ticketId: created.ticketId,
      authorId: created.authorId,
      authorName,
      authorRole,
      body: created.body,
      createdAt: created.createdAt.toISOString(),
    };
  }

  private async paginate(
    ticketId: string,
    query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    const limit = query.limit;
    const findArgs: Prisma.TicketMessageFindManyArgs = {
      where: { ticketId },
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
      ...MESSAGE_WITH_AUTHOR,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = (await this.prisma.ticketMessage.findMany(findArgs)) as MessageRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private toResponse(row: MessageRow): TicketMessage {
    return {
      id: row.id,
      ticketId: row.ticketId,
      authorId: row.authorId,
      authorName: row.author.displayName,
      authorRole: row.authorRole as TicketMessageAuthorRole,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async assertTenantParticipant(tenantId: string, ticketId: string): Promise<TicketLite> {
    const ticket = await this.loadTicketOrFail(ticketId);
    if (ticket.reporterId !== tenantId) throw this.notFound();
    return ticket;
  }

  private async assertOwnerParticipant(ownerId: string, ticketId: string): Promise<TicketLite> {
    const ticket = await this.loadTicketOrFail(ticketId);
    if (ticket.lease.ownerId !== ownerId) throw this.notFound();
    return ticket;
  }

  private async loadTicketOrFail(ticketId: string): Promise<TicketLite> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        reporterId: true,
        status: true,
        resolvedAt: true,
        closedAt: true,
        deletedAt: true,
        lease: { select: { ownerId: true } },
      },
    });
    if (!ticket || ticket.deletedAt) throw this.notFound();
    return ticket;
  }

  private assertThreadOpen(ticket: TicketLite): void {
    if (ticket.status !== 'CLOSED') return;
    const reference = ticket.closedAt ?? ticket.resolvedAt;
    if (reference && Date.now() - reference.getTime() <= POST_WINDOW_MS) return;
    throw new ProblemError({
      status: 409,
      type: ErrorCodes.TICKET_THREAD_LOCKED,
      title: 'Thread is locked',
      detail: 'This ticket is closed and outside the 7-day reopen window.',
    });
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.TICKET_NOT_FOUND,
      title: 'Ticket not found',
    });
  }
}

interface TicketLite {
  id: string;
  reporterId: string;
  status: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
  deletedAt: Date | null;
  lease: { ownerId: string };
}

export const TICKET_THREAD_POST_WINDOW_MS = POST_WINDOW_MS;
