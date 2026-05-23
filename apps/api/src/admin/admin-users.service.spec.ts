import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminUsersService } from './admin-users.service.js';
import type { AnalyticsService } from '../common/analytics/analytics.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import type { StorageService } from '../common/storage/storage.service.js';

function makeStorageStub(): StorageService {
  return {
    deleteObject: vi.fn(() => Promise.resolve()),
  } as unknown as StorageService;
}

function makeAnalyticsStub(
  opts: { posthogCalled?: boolean; status?: number | null } = {},
): AnalyticsService {
  return {
    deletePerson: vi.fn(() =>
      Promise.resolve({
        called: opts.posthogCalled ?? false,
        status: opts.status ?? null,
      }),
    ),
  } as unknown as AnalyticsService;
}

interface SeedAsset {
  id: string;
  bucket: string;
  key: string;
  ownerUserId: string;
  status: 'PENDING' | 'UPLOADED' | 'DELETED';
}

function makePrismaStub(opts: {
  targetId: string;
  isSuspended?: boolean;
  kycStatus?: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';
  alreadyErased?: boolean;
  ownedAssets?: SeedAsset[];
}) {
  const users: Record<string, unknown>[] = [
    {
      id: opts.targetId,
      email: 'tenant@example.com',
      phone: null,
      displayName: 'Test User',
      roles: ['TENANT'],
      kycStatus: opts.kycStatus ?? 'NONE',
      isSuspended: opts.isSuspended ?? false,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: opts.alreadyErased ? new Date() : null,
    },
  ];
  const mediaAssets: SeedAsset[] = [...(opts.ownedAssets ?? [])];
  const auditRows: Record<string, unknown>[] = [];

  // Declare in pieces so the `$transaction` closure can reference the
  // outer `stub` without TS complaining about a circular initializer.
  const stub: Record<string, unknown> = {};
  stub.user = {
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(users.find((u) => u.id === where.id) ?? null),
    ),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const u = users.find((x) => x.id === where.id);
      if (!u) throw new Error('not found');
      Object.assign(u, data, { updatedAt: new Date() });
      return Promise.resolve(u);
    }),
    findMany: vi.fn(() => Promise.resolve(users)),
  };
  stub.mediaAsset = {
    findMany: vi.fn(({ where }: { where: { ownerUserId: string; status?: { not: string } } }) =>
      Promise.resolve(
        mediaAssets.filter((a) => a.ownerUserId === where.ownerUserId && a.status !== 'DELETED'),
      ),
    ),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { ownerUserId: string; status?: { not: string } };
        data: { status: string; deletedAt: Date };
      }) => {
        let count = 0;
        for (const a of mediaAssets) {
          if (a.ownerUserId === where.ownerUserId && a.status !== 'DELETED') {
            a.status = data.status as SeedAsset['status'];
            count++;
          }
        }
        return Promise.resolve({ count });
      },
    ),
  };
  stub.auditLog = {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
      return Promise.resolve(auditRows.at(-1));
    }),
  };
  const notificationPrefs: {
    userId: string;
    topic: string;
    scope: 'ALL' | 'EMAIL' | 'IN_APP';
    muted: boolean;
  }[] = [];
  stub.notificationPreference = {
    findMany: vi.fn(({ where }: { where: { userId: string } }) =>
      Promise.resolve(notificationPrefs.filter((p) => p.userId === where.userId)),
    ),
  };
  const quietHours: { userId: string; startUtcMinute: number; endUtcMinute: number }[] = [];
  stub.notificationQuietHours = {
    findUnique: vi.fn(({ where }: { where: { userId: string } }) =>
      Promise.resolve(quietHours.find((q) => q.userId === where.userId) ?? null),
    ),
  };

  // Phase 10.7 — minimal stubs for the three read-only support views.
  const tickets: TicketSeed[] = [];
  stub.ticket = {
    findMany: vi.fn(
      ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: { OR?: { reporterId?: string; assigneeId?: string }[]; deletedAt: null };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        let filtered = tickets.filter((t) => {
          if (t.deletedAt) return false;
          const ors = where.OR ?? [];
          return ors.some(
            (o) =>
              (o.reporterId !== undefined && o.reporterId === t.reporterId) ||
              (o.assigneeId !== undefined && o.assigneeId === t.assigneeId),
          );
        });
        if (cursor) {
          const idx = filtered.findIndex((t) => t.id === cursor.id);
          if (idx >= 0) filtered = filtered.slice(idx + (skip ?? 0));
        }
        return Promise.resolve(filtered.slice(0, take));
      },
    ),
  };
  const bills: BillSeed[] = [];
  stub.bill = {
    findMany: vi.fn(
      ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: { lease: { OR: { tenantId?: string; ownerId?: string }[] } };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const ors = where.lease.OR;
        let filtered = bills.filter((b) =>
          ors.some(
            (o) =>
              (o.tenantId !== undefined && o.tenantId === b._tenantId) ||
              (o.ownerId !== undefined && o.ownerId === b._ownerId),
          ),
        );
        if (cursor) {
          const idx = filtered.findIndex((b) => b.id === cursor.id);
          if (idx >= 0) filtered = filtered.slice(idx + (skip ?? 0));
        }
        return Promise.resolve(filtered.slice(0, take));
      },
    ),
  };
  const payments: PaymentSeed[] = [];
  stub.payment = {
    findMany: vi.fn(
      ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: { bill: { lease: { OR: { tenantId?: string; ownerId?: string }[] } } };
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const ors = where.bill.lease.OR;
        let filtered = payments.filter((p) =>
          ors.some(
            (o) =>
              (o.tenantId !== undefined && o.tenantId === p._tenantId) ||
              (o.ownerId !== undefined && o.ownerId === p._ownerId),
          ),
        );
        if (cursor) {
          const idx = filtered.findIndex((p) => p.id === cursor.id);
          if (idx >= 0) filtered = filtered.slice(idx + (skip ?? 0));
        }
        return Promise.resolve(filtered.slice(0, take));
      },
    ),
  };

  stub.$transaction = vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(stub));
  return {
    stub,
    users,
    mediaAssets,
    auditRows,
    notificationPrefs,
    quietHours,
    tickets,
    bills,
    payments,
  };
}

interface TicketSeed {
  id: string;
  leaseId: string;
  lease: { unitId: string; unit: { houseId: string } };
  reporterId: string;
  reporter: { displayName: string };
  assigneeId: string | null;
  category: 'REPAIR' | 'REPORT' | 'COMPLAINT' | 'REQUEST' | 'OTHER';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
  title: string;
  body: string;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface BillSeed {
  id: string;
  leaseId: string;
  _tenantId: string;
  _ownerId: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  issuedAt: Date | null;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'OVERDUE' | 'VOID' | 'PARTIALLY_PAID';
  subtotal: number;
  total: number;
  currency: string;
  lines: {
    id: string;
    billId: string;
    kind: 'RENT' | 'DEPOSIT' | 'OTHER' | 'LATE_FEE' | 'ADJUSTMENT' | 'SERVICE_FEE';
    label: string;
    amount: number;
    quantity: number;
    createdAt: Date;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

interface PaymentSeed {
  id: string;
  billId: string;
  _tenantId: string;
  _ownerId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  provider: 'STRIPE' | 'VNPAY' | 'MANUAL' | 'MOMO';
  providerRef: string | null;
  providerCaptureRef: string | null;
  note: string | null;
  receivedAt: Date | null;
  failureReason: string | null;
  refundOfPaymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ctx = { actorId: 'admin_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('AdminUsersService', () => {
  const targetId = 'user_1';
  let service: AdminUsersService;
  let stub: ReturnType<typeof makePrismaStub>;

  beforeEach(() => {
    stub = makePrismaStub({ targetId });
    const audit = new AuditLogger(stub.stub as never);
    service = new AdminUsersService(
      stub.stub as never,
      audit,
      makeStorageStub(),
      makeAnalyticsStub(),
    );
  });

  it('suspend flips isSuspended and writes the audit entry atomically', async () => {
    await service.suspend(targetId, { reason: 'abuse' }, ctx);
    expect(stub.users[0]?.isSuspended).toBe(true);
    expect(stub.auditRows).toHaveLength(1);
    expect(stub.auditRows[0]).toMatchObject({
      action: 'user.suspend',
      target: `User:${targetId}`,
      actorId: ctx.actorId,
    });
  });

  it('suspending an already-suspended user → 409', async () => {
    stub = makePrismaStub({ targetId, isSuspended: true });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await expect(service.suspend(targetId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('unsuspend writes the matching audit action', async () => {
    stub = makePrismaStub({ targetId, isSuspended: true });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await service.unsuspend(targetId, { reason: 'cleared' }, ctx);
    expect(stub.users[0]?.isSuspended).toBe(false);
    expect(stub.auditRows[0]?.action).toBe('user.unsuspend');
  });

  it('admin cannot suspend themselves → 422', async () => {
    await expect(service.suspend(ctx.actorId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('KYC approve writes user.kyc.approve and stores previousStatus', async () => {
    stub = makePrismaStub({ targetId, kycStatus: 'PENDING' });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await service.kycDecision(targetId, { decision: 'APPROVED' }, ctx);
    expect(stub.users[0]?.kycStatus).toBe('APPROVED');
    expect(stub.auditRows[0]?.action).toBe('user.kyc.approve');
    expect((stub.auditRows[0]?.meta as Record<string, unknown>).previousStatus).toBe('PENDING');
  });

  it('KYC reject requires + records the reason', async () => {
    stub = makePrismaStub({ targetId, kycStatus: 'PENDING' });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await service.kycDecision(targetId, { decision: 'REJECTED', reason: 'ID photo blurry' }, ctx);
    expect(stub.users[0]?.kycStatus).toBe('REJECTED');
    expect(stub.auditRows[0]?.action).toBe('user.kyc.reject');
    expect((stub.auditRows[0]?.meta as Record<string, unknown>).reason).toBe('ID photo blurry');
  });

  it('KYC decision to the current status → 409', async () => {
    stub = makePrismaStub({ targetId, kycStatus: 'APPROVED' });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await expect(
      service.kycDecision(targetId, { decision: 'APPROVED' }, ctx),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('missing user → 404', async () => {
    await expect(service.suspend('nope', { reason: 'x' }, ctx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  // ---- erase (Phase 9.3) ------------------------------------------

  it('erase anonymises the User row, soft-deletes, and audits', async () => {
    stub = makePrismaStub({
      targetId,
      ownedAssets: [
        {
          id: 'asset_1',
          bucket: 'bds-uploads',
          key: 'campaign_photo/u/1/x.jpg',
          ownerUserId: targetId,
          status: 'UPLOADED',
        },
      ],
    });
    const storage = makeStorageStub();
    const analytics = makeAnalyticsStub({ posthogCalled: true, status: 200 });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      storage,
      analytics,
    );

    const res = await service.erase(targetId, ctx);

    // User row is anonymised + soft-deleted.
    expect(res.email).toBeNull();
    expect(res.phone).toBeNull();
    expect(res.displayName).toBe(`deleted-${targetId.slice(0, 8)}`);
    expect(res.deletedAt).not.toBeNull();

    // MediaAsset row flipped + S3 purge invoked.
    expect(stub.mediaAssets[0]?.status).toBe('DELETED');
    const deleteMock = (storage as unknown as { deleteObject: { mock: { calls: unknown[] } } })
      .deleteObject;
    expect(deleteMock.mock.calls).toHaveLength(1);

    // Two audit rows: in-tx (user.erase) + post-side-effects (completed).
    const actions = stub.auditRows.map((r) => r.action);
    expect(actions).toContain('user.erase');
    expect(actions).toContain('user.erase.completed');
    const completed = stub.auditRows.find((r) => r.action === 'user.erase.completed');
    expect(completed?.meta).toMatchObject({
      mediaAssetsPurged: 1,
      posthogDeleted: true,
      posthogStatus: 200,
    });
  });

  it('erase records mediaAssetsPurged: 0 when the user owns no assets', async () => {
    stub = makePrismaStub({ targetId, ownedAssets: [] });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await service.erase(targetId, ctx);
    const completed = stub.auditRows.find((r) => r.action === 'user.erase.completed');
    expect(completed?.meta).toMatchObject({ mediaAssetsPurged: 0 });
  });

  it('erase records posthogDeleted: false when the personal API key is unset', async () => {
    stub = makePrismaStub({ targetId });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      // Default analytics stub returns called: false.
      makeAnalyticsStub(),
    );
    await service.erase(targetId, ctx);
    const completed = stub.auditRows.find((r) => r.action === 'user.erase.completed');
    expect(completed?.meta).toMatchObject({ posthogDeleted: false, posthogStatus: null });
  });

  it('erase blocks self-erasure (admin cannot erase themselves) → 422', async () => {
    await expect(service.erase(ctx.actorId, ctx)).rejects.toMatchObject({
      status: 422,
      type: 'admin.cannot_act_on_self',
    });
  });

  it('erase on an already-erased user → 422', async () => {
    stub = makePrismaStub({ targetId, alreadyErased: true });
    service = new AdminUsersService(
      stub.stub as never,
      new AuditLogger(stub.stub as never),
      makeStorageStub(),
      makeAnalyticsStub(),
    );
    await expect(service.erase(targetId, ctx)).rejects.toMatchObject({
      status: 422,
      type: 'admin.user_already_erased',
    });
  });

  // ---- Phase 10.4 — notification-state read ----------------------

  it('getNotificationState returns prefs + quiet hours for the target', async () => {
    stub.notificationPrefs.push(
      { userId: targetId, topic: 'bill.issued', scope: 'EMAIL', muted: true },
      { userId: targetId, topic: 'ticket.opened', scope: 'ALL', muted: true },
    );
    stub.quietHours.push({ userId: targetId, startUtcMinute: 1320, endUtcMinute: 480 });

    const res = await service.getNotificationState(targetId);
    expect(res.preferences).toEqual(
      expect.arrayContaining([
        { topic: 'bill.issued', scope: 'EMAIL', muted: true },
        { topic: 'ticket.opened', scope: 'ALL', muted: true },
      ]),
    );
    expect(res.quietHours).toEqual({ startUtcMinute: 1320, endUtcMinute: 480 });
  });

  it('getNotificationState returns empty prefs + null quiet hours when nothing set', async () => {
    const res = await service.getNotificationState(targetId);
    expect(res.preferences).toEqual([]);
    expect(res.quietHours).toBeNull();
  });

  it('getNotificationState 404 on unknown / erased target', async () => {
    await expect(service.getNotificationState('not_a_user')).rejects.toBeInstanceOf(ProblemError);
  });

  // ---- Phase 10.7 — read-only support views ---------------------

  it('listTicketsForUser includes reporter + assignee rows', async () => {
    stub.tickets.push(
      makeTicket('t_a', { reporterId: targetId }),
      makeTicket('t_b', { assigneeId: targetId, reporterId: 'other' }),
      makeTicket('t_c', { reporterId: 'other', assigneeId: 'other' }),
    );
    const res = await service.listTicketsForUser(targetId, { limit: 20, sort: 'desc' });
    expect(res.items.map((t) => t.id).sort()).toEqual(['t_a', 't_b']);
    expect(res.nextCursor).toBeNull();
  });

  it('listTicketsForUser 404 for an unknown user', async () => {
    await expect(
      service.listTicketsForUser('not_a_user', { limit: 20, sort: 'desc' }),
    ).rejects.toBeInstanceOf(ProblemError);
  });

  it('listTicketsForUser paginates with nextCursor when more rows are available', async () => {
    for (let i = 0; i < 25; i++) {
      stub.tickets.push(makeTicket(`t_${i}`, { reporterId: targetId }));
    }
    const res = await service.listTicketsForUser(targetId, { limit: 20, sort: 'desc' });
    expect(res.items).toHaveLength(20);
    expect(res.nextCursor).toBe('t_19');
  });

  it('listBillsForUser includes tenant-side + owner-side rows', async () => {
    stub.bills.push(
      makeBill('b_t', { tenantId: targetId, ownerId: 'other' }),
      makeBill('b_o', { tenantId: 'other', ownerId: targetId }),
      makeBill('b_n', { tenantId: 'other', ownerId: 'other' }),
    );
    const res = await service.listBillsForUser(targetId, { limit: 20, sort: 'desc' });
    expect(res.items.map((b) => b.id).sort()).toEqual(['b_o', 'b_t']);
  });

  it('listPaymentsForUser surfaces refunds alongside their original charge', async () => {
    stub.payments.push(
      makePayment('p_charge', { tenantId: targetId, amount: 1000, refundOf: null }),
      makePayment('p_refund', {
        tenantId: targetId,
        amount: -1000,
        refundOf: 'p_charge',
      }),
      makePayment('p_other', { tenantId: 'other', amount: 500, refundOf: null }),
    );
    const res = await service.listPaymentsForUser(targetId, { limit: 20, sort: 'desc' });
    expect(res.items.map((p) => p.id).sort()).toEqual(['p_charge', 'p_refund']);
    const refund = res.items.find((p) => p.id === 'p_refund');
    expect(refund?.refundOfPaymentId).toBe('p_charge');
    expect(refund?.amount).toBe(-1000);
  });
});

function makeTicket(id: string, opts: Partial<TicketSeed>): TicketSeed {
  return {
    id,
    leaseId: opts.leaseId ?? 'lease_1',
    lease: { unitId: 'unit_1', unit: { houseId: 'house_1' } },
    reporterId: opts.reporterId ?? 'someone',
    reporter: { displayName: 'Test' },
    assigneeId: opts.assigneeId ?? null,
    category: opts.category ?? 'REPAIR',
    status: opts.status ?? 'OPEN',
    title: opts.title ?? 'Title',
    body: opts.body ?? 'Body',
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeBill(id: string, opts: { tenantId: string; ownerId: string }): BillSeed {
  return {
    id,
    leaseId: `lease_${id}`,
    _tenantId: opts.tenantId,
    _ownerId: opts.ownerId,
    periodStart: new Date('2026-05-01'),
    periodEnd: new Date('2026-05-31'),
    dueDate: new Date('2026-05-15'),
    issuedAt: null,
    status: 'ISSUED',
    subtotal: 1_000_000,
    total: 1_000_000,
    currency: 'VND',
    lines: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePayment(
  id: string,
  opts: { tenantId: string; amount: number; refundOf: string | null },
): PaymentSeed {
  return {
    id,
    billId: 'bill_1',
    _tenantId: opts.tenantId,
    _ownerId: 'someone',
    amount: opts.amount,
    currency: 'VND',
    status: 'SUCCEEDED',
    provider: 'MANUAL',
    providerRef: null,
    providerCaptureRef: null,
    note: null,
    receivedAt: null,
    failureReason: null,
    refundOfPaymentId: opts.refundOf,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
