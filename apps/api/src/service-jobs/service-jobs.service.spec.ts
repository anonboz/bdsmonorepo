import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServiceJobsService } from './service-jobs.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface StubOpts {
  ownerId: string;
  partnerUserId: string;
  partnerId: string;
  partnerSuspended?: boolean;
  partnerDeleted?: boolean;
}

function makePrismaStub(opts: StubOpts) {
  const jobs: Record<string, unknown>[] = [];
  const auditRows: Record<string, unknown>[] = [];
  const ledgerEntries: Record<string, unknown>[] = [];
  // Ticket fixture — tests that exercise the 5.3 path push their own rows
  // into this array and the create-call wires them in.
  const tickets: Record<string, unknown>[] = [];
  const partnerProfiles: Record<string, unknown>[] = [
    {
      id: opts.partnerId,
      userId: opts.partnerUserId,
      businessName: 'Bob Plumbing',
      deletedAt: opts.partnerDeleted ? new Date() : null,
    },
  ];
  const users: Record<string, unknown>[] = [
    {
      id: opts.partnerUserId,
      isSuspended: opts.partnerSuspended ?? false,
      deletedAt: null,
    },
  ];

  function withRelations(row: Record<string, unknown>) {
    const p = partnerProfiles.find((x) => x.id === row.partnerId);
    return {
      ...row,
      partner: p
        ? { businessName: p.businessName, userId: p.userId, deletedAt: p.deletedAt }
        : null,
      service: null,
    };
  }

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    partnerProfile: {
      findUnique: vi.fn(({ where }: { where: { id?: string; userId?: string } }) => {
        const row = partnerProfiles.find(
          (p) =>
            (where.id != null && p.id === where.id) ||
            (where.userId != null && p.userId === where.userId),
        );
        if (!row) return Promise.resolve(null);
        const u = users.find((x) => x.id === row.userId);
        return Promise.resolve({
          ...row,
          user: u ? { isSuspended: u.isSuspended, deletedAt: u.deletedAt } : null,
        });
      }),
    },
    serviceJob: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `job_${jobs.length + 1}`,
          ...data,
          serviceId: data.serviceId ?? null,
          unitId: data.unitId ?? null,
          ticketId: data.ticketId ?? null,
          description: data.description ?? null,
          quotedAmount: null,
          finalAmount: null,
          currency: null,
          scheduledFor: data.scheduledFor ?? null,
          completedAt: null,
          cancelReason: null,
          cancelledBy: null,
          proofPhotos: [] as string[],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        jobs.push(row);
        return Promise.resolve(withRelations(row));
      }),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = jobs.find((j) => j.id === where.id);
        return Promise.resolve(row ? withRelations(row) : null);
      }),
      findMany: vi.fn(({ where }: { where: Record<string, unknown> }) => {
        const filtered = jobs.filter((j) => {
          if (where.ownerId !== undefined && j.ownerId !== where.ownerId) return false;
          if (where.partnerId !== undefined && j.partnerId !== where.partnerId) return false;
          if (where.status !== undefined && j.status !== where.status) return false;
          if (where.ticketId !== undefined && j.ticketId !== where.ticketId) return false;
          return true;
        });
        return Promise.resolve(filtered.map(withRelations));
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = jobs.find((j) => j.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return Promise.resolve(withRelations(row));
      }),
    },
    ticket: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = tickets.find((t) => t.id === where.id);
        return Promise.resolve(row ?? null);
      }),
    },
    jobLedgerEntry: {
      count: vi.fn(({ where }: { where: { jobId: string; kind?: string } }) => {
        return Promise.resolve(
          ledgerEntries.filter(
            (e) => e.jobId === where.jobId && (where.kind == null || e.kind === where.kind),
          ).length,
        );
      }),
      createMany: vi.fn(({ data }: { data: Record<string, unknown>[] }) => {
        for (const row of data) {
          ledgerEntries.push({
            id: `led_${ledgerEntries.length + 1}`,
            status: row.status ?? 'PENDING',
            ...row,
          });
        }
        return Promise.resolve({ count: data.length });
      }),
    },
    auditLog: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
        return Promise.resolve(auditRows.at(-1));
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, jobs, auditRows, partnerProfiles, users, tickets, ledgerEntries };
}

const ownerCtx = { actorId: 'owner_1', ip: '127.0.0.1', userAgent: 'curl/test' };
const partnerCtx = { actorId: 'partner_user_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('ServiceJobsService', () => {
  const ownerId = 'owner_1';
  const partnerUserId = 'partner_user_1';
  const partnerId = 'partner_1';
  let service: ServiceJobsService;
  let store: ReturnType<typeof makePrismaStub>;

  function boot(overrides: Partial<StubOpts> = {}) {
    store = makePrismaStub({ ownerId, partnerUserId, partnerId, ...overrides });
    service = new ServiceJobsService(store.stub as never, new AuditLogger(store.stub as never));
  }

  beforeEach(() => boot());

  it('owner creates a REQUESTED job + audit row', async () => {
    const j = await service.createForOwner(
      ownerId,
      { partnerId, description: 'leaky pipe' },
      ownerCtx,
    );
    expect(j.status).toBe('REQUESTED');
    expect(j.ownerId).toBe(ownerId);
    expect(j.partnerId).toBe(partnerId);
    expect(j.description).toBe('leaky pipe');
    expect(store.auditRows[0]?.action).toBe('job.request');
  });

  it('book a suspended partner → 422 partner_not_bookable', async () => {
    boot({ partnerSuspended: true });
    await expect(service.createForOwner(ownerId, { partnerId }, ownerCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('book a soft-deleted partner profile → 422', async () => {
    boot({ partnerDeleted: true });
    await expect(service.createForOwner(ownerId, { partnerId }, ownerCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('full happy path: request → quote → accept → start → complete', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);

    const quoted = await service.quoteForPartner(
      partnerUserId,
      j.id,
      { amount: 50_000, currency: 'VND' },
      partnerCtx,
    );
    expect(quoted.status).toBe('QUOTED');
    expect(quoted.quotedAmount).toBe(50_000);

    const accepted = await service.acceptForOwner(ownerId, j.id, ownerCtx);
    expect(accepted.status).toBe('ACCEPTED');

    const started = await service.startForPartner(partnerUserId, j.id, partnerCtx);
    expect(started.status).toBe('IN_PROGRESS');

    const completed = await service.completeForPartner(
      partnerUserId,
      j.id,
      { proofPhotos: ['https://example.com/p1.jpg'] },
      partnerCtx,
    );
    expect(completed.status).toBe('COMPLETED');
    // finalAmount defaults to quotedAmount when omitted.
    expect(completed.finalAmount).toBe(50_000);
    expect(completed.proofPhotos).toEqual(['https://example.com/p1.jpg']);
    expect(completed.completedAt).not.toBeNull();

    const actions = store.auditRows.map((r) => r.action);
    expect(actions).toEqual([
      'job.request',
      'job.quote',
      'job.accept',
      'job.start',
      'job.complete',
      'job.ledger_minted',
    ]);
  });

  // ---- Ledger minting on complete (5.4) -----------------------------

  async function bringJobToInProgress(): Promise<string> {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await service.quoteForPartner(
      partnerUserId,
      j.id,
      { amount: 50_000, currency: 'VND' },
      partnerCtx,
    );
    await service.acceptForOwner(ownerId, j.id, ownerCtx);
    await service.startForPartner(partnerUserId, j.id, partnerCtx);
    return j.id;
  }

  it('completing a job mints 3 ledger entries that sum to zero', async () => {
    const id = await bringJobToInProgress();
    await service.completeForPartner(partnerUserId, id, {}, partnerCtx);

    const entries = store.ledgerEntries.filter((e) => e.jobId === id);
    expect(entries).toHaveLength(3);
    const sum = entries.reduce((acc, e) => acc + (e.amount as number), 0);
    expect(sum).toBe(0);

    const charge = entries.find((e) => e.kind === 'CHARGE')!;
    const commission = entries.find((e) => e.kind === 'COMMISSION')!;
    const payout = entries.find((e) => e.kind === 'PAYOUT')!;

    // 10% commission on 50_000 → 5_000 platform cut, 45_000 partner cut.
    expect(charge.amount).toBe(-50_000);
    expect(charge.status).toBe('PENDING');
    expect(charge.accountUserId).toBe(ownerId);
    expect(commission.amount).toBe(5_000);
    expect(commission.status).toBe('PENDING');
    expect(commission.accountUserId).toBeNull();
    expect(payout.amount).toBe(45_000);
    expect(payout.status).toBe('HELD');
    expect(payout.accountUserId).toBe(partnerUserId);
    expect(payout.cooldownUntil).toBeInstanceOf(Date);
  });

  it('zero-amount job mints three zero-value entries', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await service.quoteForPartner(partnerUserId, j.id, { amount: 0, currency: 'VND' }, partnerCtx);
    await service.acceptForOwner(ownerId, j.id, ownerCtx);
    await service.startForPartner(partnerUserId, j.id, partnerCtx);
    await service.completeForPartner(partnerUserId, j.id, {}, partnerCtx);

    const entries = store.ledgerEntries.filter((e) => e.jobId === j.id);
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(e.amount).toBe(0);
  });

  it('commission floors toward zero (partner picks up the remainder)', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    // 1234 * 10% = 123.4 → commission floors to 123, partner = 1111.
    await service.quoteForPartner(
      partnerUserId,
      j.id,
      { amount: 1234, currency: 'VND' },
      partnerCtx,
    );
    await service.acceptForOwner(ownerId, j.id, ownerCtx);
    await service.startForPartner(partnerUserId, j.id, partnerCtx);
    await service.completeForPartner(partnerUserId, j.id, {}, partnerCtx);

    const entries = store.ledgerEntries.filter((e) => e.jobId === j.id);
    const commission = entries.find((e) => e.kind === 'COMMISSION')!;
    const payout = entries.find((e) => e.kind === 'PAYOUT')!;
    expect(commission.amount).toBe(123);
    expect(payout.amount).toBe(1111);
  });

  it('owner cancels a REQUESTED job → CANCELLED with reason + cancelledBy', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    const c = await service.cancelForOwner(ownerId, j.id, { reason: 'mind changed' }, ownerCtx);
    expect(c.status).toBe('CANCELLED');
    expect(c.cancelReason).toBe('mind changed');
    expect(c.cancelledBy).toBe(ownerCtx.actorId);
    expect(store.auditRows.at(-1)?.action).toBe('job.cancel');
  });

  it('partner cancels a QUOTED job → CANCELLED', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await service.quoteForPartner(
      partnerUserId,
      j.id,
      { amount: 100, currency: 'VND' },
      partnerCtx,
    );
    const c = await service.cancelForPartner(
      partnerUserId,
      j.id,
      { reason: 'cant make it' },
      partnerCtx,
    );
    expect(c.status).toBe('CANCELLED');
    expect(c.cancelledBy).toBe(partnerCtx.actorId);
  });

  it('cross-owner GET → 404 (existence hiding)', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await expect(service.getForOwner('owner_2', j.id)).rejects.toBeInstanceOf(ProblemError);
  });

  it('cross-partner quote → 404', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    store.users.push({ id: 'partner_user_2', isSuspended: false, deletedAt: null });
    store.partnerProfiles.push({
      id: 'partner_2',
      userId: 'partner_user_2',
      businessName: 'Other',
      deletedAt: null,
    });
    await expect(
      service.quoteForPartner('partner_user_2', j.id, { amount: 1, currency: 'VND' }, partnerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('invalid transition (owner accept on REQUESTED) → 422 + no audit', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    const beforeAudit = store.auditRows.length;
    await expect(service.acceptForOwner(ownerId, j.id, ownerCtx)).rejects.toBeInstanceOf(
      ProblemError,
    );
    expect(store.auditRows).toHaveLength(beforeAudit);
  });

  it('cancel on COMPLETED → 422 (terminal)', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await service.quoteForPartner(partnerUserId, j.id, { amount: 1, currency: 'VND' }, partnerCtx);
    await service.acceptForOwner(ownerId, j.id, ownerCtx);
    await service.startForPartner(partnerUserId, j.id, partnerCtx);
    await service.completeForPartner(partnerUserId, j.id, {}, partnerCtx);
    await expect(
      service.cancelForOwner(ownerId, j.id, { reason: 'too late' }, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('partner without a profile can never quote → 404 profile_not_found', async () => {
    const j = await service.createForOwner(ownerId, { partnerId }, ownerCtx);
    await expect(
      service.quoteForPartner('unknown_user', j.id, { amount: 1, currency: 'VND' }, partnerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  // ---- Ticket-routed booking (5.3) -----------------------------------

  function seedOwnerTicket(opts: { id: string; status?: string; ownerId?: string }): void {
    store.tickets.push({
      id: opts.id,
      status: opts.status ?? 'OPEN',
      deletedAt: null,
      lease: { ownerId: opts.ownerId ?? ownerId, unitId: 'unit_from_ticket' },
    });
  }

  it('ticket-routed booking sets ticketId + derives unitId from the ticket lease', async () => {
    seedOwnerTicket({ id: 'ticket_a', status: 'OPEN' });
    const j = await service.createForOwner(ownerId, { partnerId, ticketId: 'ticket_a' }, ownerCtx);
    expect(j.ticketId).toBe('ticket_a');
    expect(j.unitId).toBe('unit_from_ticket');
    const submit = store.auditRows.find((r) => r.action === 'job.request');
    expect((submit?.meta as Record<string, unknown>).ticketId).toBe('ticket_a');
    expect((submit?.meta as Record<string, unknown>).unitId).toBe('unit_from_ticket');
  });

  it('cross-owner ticket id → 404', async () => {
    seedOwnerTicket({ id: 'ticket_b', status: 'OPEN', ownerId: 'someone_else' });
    await expect(
      service.createForOwner(ownerId, { partnerId, ticketId: 'ticket_b' }, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('booking on a RESOLVED ticket → 422 ticket_not_bookable', async () => {
    seedOwnerTicket({ id: 'ticket_resolved', status: 'RESOLVED' });
    await expect(
      service.createForOwner(ownerId, { partnerId, ticketId: 'ticket_resolved' }, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('booking on a CLOSED ticket → 422', async () => {
    seedOwnerTicket({ id: 'ticket_closed', status: 'CLOSED' });
    await expect(
      service.createForOwner(ownerId, { partnerId, ticketId: 'ticket_closed' }, ownerCtx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('client-supplied unitId is ignored when ticketId is set', async () => {
    seedOwnerTicket({ id: 'ticket_override', status: 'OPEN' });
    const j = await service.createForOwner(
      ownerId,
      { partnerId, ticketId: 'ticket_override', unitId: 'unit_client' },
      ownerCtx,
    );
    expect(j.unitId).toBe('unit_from_ticket');
  });

  it('listForOwner filters by ticketId', async () => {
    seedOwnerTicket({ id: 'ticket_filter', status: 'OPEN' });
    const linked = await service.createForOwner(
      ownerId,
      { partnerId, ticketId: 'ticket_filter' },
      ownerCtx,
    );
    await service.createForOwner(ownerId, { partnerId }, ownerCtx); // unrelated
    const page = await service.listForOwner(ownerId, {
      limit: 20,
      sort: 'desc',
      ticketId: 'ticket_filter',
    });
    expect(page.items.map((j) => j.id)).toEqual([linked.id]);
  });
});
