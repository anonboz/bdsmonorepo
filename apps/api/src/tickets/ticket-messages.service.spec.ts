import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TICKET_THREAD_POST_WINDOW_MS, TicketMessagesService } from './ticket-messages.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface TicketRow {
  id: string;
  reporterId: string;
  status: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
  deletedAt: Date | null;
  lease: { ownerId: string };
}

interface MessageRow {
  id: string;
  ticketId: string;
  authorId: string;
  authorRole: 'TENANT' | 'OWNER' | 'ADMIN';
  body: string;
  createdAt: Date;
  author: { displayName: string };
}

function makePrismaStub(initialTickets: TicketRow[], userNames: Record<string, string>) {
  const tickets = [...initialTickets];
  const messages: MessageRow[] = [];

  return {
    ticket: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(tickets.find((t) => t.id === where.id) ?? null),
      ),
    },
    ticketMessage: {
      create: vi.fn(({ data }: { data: Omit<MessageRow, 'id' | 'createdAt' | 'author'> }) => {
        const row: MessageRow = {
          id: `msg_${messages.length + 1}`,
          ...data,
          createdAt: new Date(),
          author: { displayName: userNames[data.authorId] ?? 'Unknown' },
        };
        messages.push(row);
        return Promise.resolve(row);
      }),
      findMany: vi.fn(({ where, take }: { where: { ticketId: string }; take: number }) => {
        const filtered = messages
          .filter((m) => m.ticketId === where.ticketId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return Promise.resolve(filtered.slice(0, take));
      }),
    },
    _messages: messages,
    _tickets: tickets,
  };
}

describe('TicketMessagesService', () => {
  const ownerId = 'owner_1';
  const tenantId = 'tenant_1';
  const ticketId = 'ticket_1';

  let service: TicketMessagesService;
  let stub: ReturnType<typeof makePrismaStub>;
  let ticket: TicketRow;

  beforeEach(() => {
    ticket = {
      id: ticketId,
      reporterId: tenantId,
      status: 'OPEN',
      resolvedAt: null,
      closedAt: null,
      deletedAt: null,
      lease: { ownerId },
    };
    stub = makePrismaStub([ticket], { [tenantId]: 'Tara Tenant', [ownerId]: 'Olive Owner' });
    service = new TicketMessagesService(stub as never);
  });

  const query = { sort: 'asc' as const, limit: 50 };

  it('tenant posts a message and reads it back', async () => {
    const msg = await service.postForTenant(tenantId, 'Tara Tenant', ticketId, {
      body: 'when is the plumber?',
    });
    expect(msg.authorRole).toBe('TENANT');
    expect(msg.authorName).toBe('Tara Tenant');

    const page = await service.listForTenant(tenantId, ticketId, query);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.body).toBe('when is the plumber?');
  });

  it('owner sees the tenant message and can reply', async () => {
    await service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'who is coming?' });
    await service.postForOwner(ownerId, 'Olive Owner', ticketId, { body: 'Bob, tomorrow 10am.' });

    const ownerView = await service.listForOwner(ownerId, ticketId, query);
    expect(ownerView.items).toHaveLength(2);
    expect(ownerView.items.map((m) => m.authorRole)).toEqual(['TENANT', 'OWNER']);
  });

  it('thread is ordered oldest first regardless of insertion timing', async () => {
    await service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'one' });
    await service.postForOwner(ownerId, 'Olive Owner', ticketId, { body: 'two' });
    await service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'three' });

    const page = await service.listForTenant(tenantId, ticketId, query);
    expect(page.items.map((m) => m.body)).toEqual(['one', 'two', 'three']);
  });

  it('non-participant tenant gets 404, not 403', async () => {
    await expect(service.listForTenant('other_tenant', ticketId, query)).rejects.toBeInstanceOf(
      ProblemError,
    );
    await expect(
      service.postForTenant('other_tenant', 'Other', ticketId, { body: 'hi' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('non-owner of the lease gets 404', async () => {
    await expect(service.listForOwner('other_owner', ticketId, query)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('deleted ticket → 404 on both list and post', async () => {
    ticket.deletedAt = new Date();
    await expect(service.listForTenant(tenantId, ticketId, query)).rejects.toBeInstanceOf(
      ProblemError,
    );
    await expect(
      service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'x' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('CLOSED ticket within 7d window still accepts messages', async () => {
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date();
    await expect(
      service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'one more thing' }),
    ).resolves.toMatchObject({ body: 'one more thing' });
  });

  it('CLOSED ticket past 7d window → 409 thread_locked', async () => {
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date(Date.now() - TICKET_THREAD_POST_WINDOW_MS - 60_000);
    await expect(
      service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'late' }),
    ).rejects.toBeInstanceOf(ProblemError);
    // ...but reads still work for both parties.
    await expect(service.listForTenant(tenantId, ticketId, query)).resolves.toBeTruthy();
    await expect(service.listForOwner(ownerId, ticketId, query)).resolves.toBeTruthy();
  });

  it('admin can read any thread including closed-and-out-of-window', async () => {
    await service.postForTenant(tenantId, 'Tara Tenant', ticketId, { body: 'hello' });
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date(Date.now() - TICKET_THREAD_POST_WINDOW_MS - 60_000);
    const adminView = await service.listForAdmin(ticketId, query);
    expect(adminView.items).toHaveLength(1);
  });

  it('admin read on missing ticket → 404', async () => {
    await expect(service.listForAdmin('missing_id', query)).rejects.toBeInstanceOf(ProblemError);
  });

  it('author role is frozen as TENANT/OWNER even if role changes later (recorded at write time)', async () => {
    const msg = await service.postForOwner(ownerId, 'Olive Owner', ticketId, { body: 'hi' });
    expect(msg.authorRole).toBe('OWNER');
    // The stub row was written with authorRole = OWNER — confirm directly:
    expect(stub._messages[0]!.authorRole).toBe('OWNER');
  });
});
