import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TICKET_REOPEN_WINDOW_MS, TicketsService } from './tickets.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { stubNotifications } from '../notifications/notifications.test-helper.js';

function makePrismaStub(opts: { ownerId: string; tenantId: string; leaseId: string }) {
  const tickets: Record<string, unknown>[] = [];
  const lease = {
    id: opts.leaseId,
    tenantId: opts.tenantId,
    ownerId: opts.ownerId,
    unitId: 'unit_1',
    status: 'ACTIVE',
    deletedAt: null,
    unit: { houseId: 'house_1' },
  };

  function withRelations(row: Record<string, unknown>) {
    return {
      ...row,
      reporter: { displayName: 'Reporter' },
      lease,
    };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    lease: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === lease.id ? lease : null),
      ),
    },
    ticket: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `ticket_${tickets.length + 1}`,
          ...data,
          resolvedAt: null,
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        tickets.push(row);
        return Promise.resolve(withRelations(row));
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = tickets.find((t) => t.id === where.id);
        return Promise.resolve(row ? withRelations(row) : null);
      }),
      findMany: vi.fn(() => Promise.resolve(tickets.map(withRelations))),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = tickets.find((t) => t.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(withRelations(row));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, tickets };
}

describe('TicketsService', () => {
  const ownerId = 'owner_1';
  const tenantId = 'tenant_1';
  const leaseId = 'lease_1';

  let service: TicketsService;
  let stub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    stub = makePrismaStub({ ownerId, tenantId, leaseId });
    service = new TicketsService(stub.stub as never, stubNotifications());
  });

  const draft = {
    leaseId,
    category: 'REPAIR' as const,
    title: 'Leaky faucet',
    body: 'Kitchen tap drips overnight.',
  };

  it('tenant creates a ticket against their lease', async () => {
    const t = await service.createForTenant(tenantId, draft);
    expect(t.status).toBe('OPEN');
    expect(t.reporterId).toBe(tenantId);
    expect(t.assigneeId).toBe(ownerId);
  });

  it('non-tenant on the lease → 404 ticket.lease_invalid', async () => {
    await expect(service.createForTenant('not_me', draft)).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner transition: OPEN → ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CLOSED', async () => {
    const t = await service.createForTenant(tenantId, draft);
    const a = await service.ownerTransition(ownerId, t.id, { to: 'ACKNOWLEDGED' });
    expect(a.status).toBe('ACKNOWLEDGED');
    const p = await service.ownerTransition(ownerId, t.id, { to: 'IN_PROGRESS' });
    expect(p.status).toBe('IN_PROGRESS');
    const r = await service.ownerTransition(ownerId, t.id, { to: 'RESOLVED' });
    expect(r.status).toBe('RESOLVED');
    expect(r.resolvedAt).not.toBeNull();
    const c = await service.ownerTransition(ownerId, t.id, { to: 'CLOSED' });
    expect(c.status).toBe('CLOSED');
    expect(c.closedAt).not.toBeNull();
  });

  it('owner skip-ahead OPEN → RESOLVED is allowed', async () => {
    const t = await service.createForTenant(tenantId, draft);
    const r = await service.ownerTransition(ownerId, t.id, { to: 'RESOLVED' });
    expect(r.status).toBe('RESOLVED');
  });

  it('owner cannot transition another owner’s ticket', async () => {
    const t = await service.createForTenant(tenantId, draft);
    await expect(
      service.ownerTransition('other_owner', t.id, { to: 'ACKNOWLEDGED' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('owner cannot do REOPENED (tenant-only)', async () => {
    const t = await service.createForTenant(tenantId, draft);
    await service.ownerTransition(ownerId, t.id, { to: 'RESOLVED' });
    await expect(service.ownerTransition(ownerId, t.id, { to: 'REOPENED' })).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('tenant reopens a RESOLVED ticket within the 7d window', async () => {
    const t = await service.createForTenant(tenantId, draft);
    await service.ownerTransition(ownerId, t.id, { to: 'RESOLVED' });
    const reopened = await service.tenantReopen(tenantId, t.id);
    expect(reopened.status).toBe('REOPENED');
  });

  it('tenant reopen after the 7d window → 409 reopen_window_expired', async () => {
    const t = await service.createForTenant(tenantId, draft);
    await service.ownerTransition(ownerId, t.id, { to: 'RESOLVED' });
    // Backdate resolvedAt past the window directly on the stub row.
    const row = stub.tickets[0]!;
    row.resolvedAt = new Date(Date.now() - TICKET_REOPEN_WINDOW_MS - 60_000);
    await expect(service.tenantReopen(tenantId, t.id)).rejects.toBeInstanceOf(ProblemError);
  });

  it('invalid transition (DRAFT-like skip) → 422 invalid_transition', async () => {
    const t = await service.createForTenant(tenantId, draft);
    // OPEN → IN_PROGRESS is not in ALLOWED_TRANSITIONS — must ACK first.
    await expect(
      service.ownerTransition(ownerId, t.id, { to: 'IN_PROGRESS' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('admin can read any ticket', async () => {
    const t = await service.createForTenant(tenantId, draft);
    const got = await service.getAny(t.id);
    expect(got.id).toBe(t.id);
  });
});
