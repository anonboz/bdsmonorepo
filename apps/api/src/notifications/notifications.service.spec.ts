import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  msUntilQuietHoursEnd,
  NotificationsService,
  SWEEP_MAX_RETRIES,
  SWEEP_MIN_AGE_MS,
} from './notifications.service.js';
import { renderNotification } from './notifications.templates.js';
import { NotificationsSendWorker } from './notifications.worker.js';
import type { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { MailerService } from '../common/mailer/mailer.service.js';

// `NotificationTopic` is a value re-export from @repo/shared.
const Topic = {
  BILL_ISSUED: 'bill.issued',
  BILL_PAID: 'bill.paid',
  BILL_REFUNDED: 'bill.refunded',
  TICKET_OPENED: 'ticket.opened',
  TICKET_RESOLVED: 'ticket.resolved',
  JOB_COMPLETED: 'job.completed',
  PAYOUT_DISBURSED: 'payout.disbursed',
} as const;

// ---- Prisma stub ----------------------------------------------------

function makePrismaStub() {
  const rows: Record<string, unknown>[] = [];
  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    notification: {
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `notif_${rows.length + 1}`,
          readAt: null,
          sentAt: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          // `data` last so explicit fields (e.g. failureReason) win.
          ...data,
        };
        rows.push(row);
        return Promise.resolve(row);
      }),
      findUnique: vi.fn(
        ({
          where,
          include,
        }: {
          where: { id: string };
          include?: { user?: { select?: Record<string, boolean> } };
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) return Promise.resolve(null);
          if (include?.user) {
            const overlay = row as { _userEmail?: string | null; _userLocale?: string };
            const email =
              '_userEmail' in overlay ? (overlay._userEmail ?? null) : 'tenant@example.com';
            // Phase 11.5 — worker re-reads locale to localize email + push.
            // Default 'vi' (the platform default) when the overlay
            // doesn't pin one; per-test overrides via `_userLocale`.
            const locale = overlay._userLocale ?? 'vi';
            return Promise.resolve({ ...row, user: { email, locale } });
          }
          return Promise.resolve(row);
        },
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
      updateMany: vi.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; sentAt: null };
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((r) => r.id === where.id && r.sentAt == null);
          if (row) Object.assign(row, data);
          return Promise.resolve({ count: row ? 1 : 0 });
        },
      ),
    },
    notificationPreference: {
      // Default stub: no preferences set → every dispatch goes through.
      // Individual tests override via mockResolvedValueOnce below.
      findMany: vi.fn(() => Promise.resolve([])),
      // The worker's per-scope mute check (`scope=PUSH muted=true`).
      // Default null → unmuted; tests override per-call.
      findUnique: vi.fn(() => Promise.resolve(null)),
    },
    notificationQuietHours: {
      // Default stub: no quiet hours.
      findUnique: vi.fn(() => Promise.resolve(null)),
    },
    user: {
      // Phase 11.5 — dispatch fetches the recipient's locale to render
      // the title/body in their language. Default to 'vi' (the
      // platform default); tests override per-call to assert per-locale
      // behaviour.
      findUnique: vi.fn(() => Promise.resolve({ locale: 'vi' })),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, rows };
}

function makeQueueStub() {
  const adds: { name: string; data: unknown; opts?: unknown }[] = [];
  return {
    queue: {
      add: vi.fn((name: string, data: unknown, opts?: unknown) => {
        adds.push({ name, data, opts });
        return Promise.resolve({ id: `job_${adds.length}` });
      }),
    },
    adds,
  };
}

interface AuditCall {
  actorId: string | null;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown> | null;
}

function makeAuditStub(): { audit: AuditLogger; calls: AuditCall[] } {
  const calls: AuditCall[] = [];
  const audit = {
    write: vi.fn((_tx: unknown, entry: AuditCall) => {
      calls.push(entry);
      return Promise.resolve();
    }),
    writeOnce: vi.fn((entry: AuditCall) => {
      calls.push(entry);
      return Promise.resolve();
    }),
  };
  return { audit: audit as unknown as AuditLogger, calls };
}

// ---- NotificationsService.dispatch ---------------------------------

describe('NotificationsService.dispatch', () => {
  it('persists a row with the topic renderer title + body, then post-commit enqueues', async () => {
    const prisma = makePrismaStub();
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const expectedRender = renderNotification(Topic.BILL_ISSUED, {
      amount: 500_000,
      currency: 'VND',
      dueDate: '2026-06-08',
      period: '2026-06-01 – 2026-06-30',
    });

    const { id, enqueue } = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_1',
      data: {
        amount: 500_000,
        currency: 'VND',
        dueDate: '2026-06-08',
        period: '2026-06-01 – 2026-06-30',
      },
    });

    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]).toMatchObject({
      id,
      userId: 'user_1',
      channel: 'EMAIL',
      topic: Topic.BILL_ISSUED,
      title: expectedRender.title,
      body: expectedRender.body,
    });

    // enqueue is deferred until the caller invokes it.
    expect(queue.adds).toHaveLength(0);
    await enqueue();
    expect(queue.adds).toHaveLength(1);
    expect(queue.adds[0]).toMatchObject({
      name: 'send',
      data: { notificationId: id },
    });
  });

  it('swallows queue errors so a Redis outage does not roll back the caller tx', async () => {
    const prisma = makePrismaStub();
    const queue = {
      add: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    };
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue as never, audit);
    const { enqueue } = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_PAID,
      recipientId: 'user_2',
      data: { amount: 100, currency: 'VND', provider: 'MANUAL' },
    });
    await expect(enqueue()).resolves.toBeUndefined();
    expect(prisma.rows).toHaveLength(1);
  });

  it('dispatchAndEnqueue wraps insert + enqueue and returns the row id', async () => {
    const prisma = makePrismaStub();
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const id = await service.dispatchAndEnqueue({
      topic: Topic.TICKET_OPENED,
      recipientId: 'owner_9',
      data: { ticketTitle: 'leak', tenantName: 'Alice' },
    });
    expect(id).toBe(prisma.rows[0]?.id);
    expect(queue.adds).toHaveLength(1);
  });

  it("renders the persisted title in the recipient's locale (Phase 11.5)", async () => {
    const prisma = makePrismaStub();
    const userStub = prisma.stub.user as { findUnique: ReturnType<typeof vi.fn> };
    userStub.findUnique.mockResolvedValueOnce({ locale: 'en' });
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_en',
      data: {
        amount: 500_000,
        currency: 'VND',
        dueDate: '2026-06-08',
        period: '2026-06-01 – 2026-06-30',
      },
    });

    expect(prisma.rows).toHaveLength(1);
    // EN template carries "Your rent for …"; VI carries "Tiền thuê kỳ …".
    expect(prisma.rows[0]?.title).toContain('Your rent for');
  });

  it('falls back to vi when the user row has a stale or missing locale', async () => {
    const prisma = makePrismaStub();
    const userStub = prisma.stub.user as { findUnique: ReturnType<typeof vi.fn> };
    userStub.findUnique.mockResolvedValueOnce(null);
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'ghost',
      data: { amount: 1, currency: 'VND', dueDate: 'd', period: 'p' },
    });
    expect(prisma.rows[0]?.title).toContain('Tiền thuê');
  });

  it('skips insert + enqueue when the user has muted that topic (Phase 9.4)', async () => {
    const prisma = makePrismaStub();
    // Force the preference lookup to return a full-scope mute row.
    const prefStub = prisma.stub.notificationPreference as {
      findMany: ReturnType<typeof vi.fn>;
    };
    prefStub.findMany.mockResolvedValueOnce([{ scope: 'ALL', muted: true }]);
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const result = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_1',
      data: { amount: 500_000, currency: 'VND' },
    });

    expect(result.muted).toBe(true);
    expect(result.id).toBeNull();
    expect(prisma.rows).toHaveLength(0);
    await result.enqueue();
    expect(queue.adds).toHaveLength(0);
  });
});

// ---- Phase 10.4 — per-scope + quiet hours -------------------------

describe('NotificationsService.dispatch per-scope + quiet hours', () => {
  it('email-scope mute persists the row + sets failureReason + no enqueue', async () => {
    const prisma = makePrismaStub();
    const prefStub = prisma.stub.notificationPreference as {
      findMany: ReturnType<typeof vi.fn>;
    };
    prefStub.findMany.mockResolvedValueOnce([{ scope: 'EMAIL', muted: true }]);
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const { id, enqueue, muted } = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_1',
      data: { amount: 100, currency: 'VND' },
    });
    expect(muted).toBe(false);
    expect(id).not.toBeNull();
    expect(prisma.rows).toHaveLength(1);
    expect(prisma.rows[0]?.failureReason).toBe('email channel muted by user preference');
    await enqueue();
    expect(queue.adds).toHaveLength(0);
  });

  it('IN_APP + EMAIL muted via two separate rows is treated as full-mute', async () => {
    const prisma = makePrismaStub();
    const prefStub = prisma.stub.notificationPreference as {
      findMany: ReturnType<typeof vi.fn>;
    };
    prefStub.findMany.mockResolvedValueOnce([
      { scope: 'EMAIL', muted: true },
      { scope: 'IN_APP', muted: true },
    ]);
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const { id, muted } = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_1',
      data: { amount: 100, currency: 'VND' },
    });
    expect(muted).toBe(true);
    expect(id).toBeNull();
    expect(prisma.rows).toHaveLength(0);
  });

  it('quiet hours active: row persists, enqueue carries a delay until window end', async () => {
    const prisma = makePrismaStub();
    const qhStub = prisma.stub.notificationQuietHours as {
      findUnique: ReturnType<typeof vi.fn>;
    };
    // 22:00 - 08:00 UTC quiet hours.
    qhStub.findUnique.mockResolvedValueOnce({ startUtcMinute: 22 * 60, endUtcMinute: 8 * 60 });
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    // Pretend wall-clock is 23:30 UTC; window wraps.
    const now = new Date('2026-05-23T23:30:00Z');
    const { enqueue } = await service.dispatch(
      prisma.stub as never,
      { topic: Topic.BILL_ISSUED, recipientId: 'user_1', data: { amount: 100, currency: 'VND' } },
      now,
    );
    await enqueue();
    expect(queue.adds).toHaveLength(1);
    const opts = queue.adds[0]?.opts as { delay?: number };
    // 23:30 → 08:00 next day = 8h30m = 30,600,000 ms.
    expect(opts.delay).toBe(8.5 * 60 * 60_000);
  });

  it('quiet hours configured but outside window: no delay, immediate enqueue', async () => {
    const prisma = makePrismaStub();
    const qhStub = prisma.stub.notificationQuietHours as {
      findUnique: ReturnType<typeof vi.fn>;
    };
    qhStub.findUnique.mockResolvedValueOnce({ startUtcMinute: 22 * 60, endUtcMinute: 8 * 60 });
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const now = new Date('2026-05-23T15:30:00Z'); // 15:30 UTC — outside 22-08 window
    const { enqueue } = await service.dispatch(
      prisma.stub as never,
      { topic: Topic.BILL_ISSUED, recipientId: 'user_1', data: { amount: 100, currency: 'VND' } },
      now,
    );
    await enqueue();
    expect(queue.adds).toHaveLength(1);
    const opts = queue.adds[0]?.opts as { delay?: number };
    expect(opts.delay).toBeUndefined();
  });

  it('email-mute beats quiet-hours: row persists with failureReason, no enqueue', async () => {
    const prisma = makePrismaStub();
    const prefStub = prisma.stub.notificationPreference as {
      findMany: ReturnType<typeof vi.fn>;
    };
    prefStub.findMany.mockResolvedValueOnce([{ scope: 'EMAIL', muted: true }]);
    const qhStub = prisma.stub.notificationQuietHours as {
      findUnique: ReturnType<typeof vi.fn>;
    };
    qhStub.findUnique.mockResolvedValueOnce({ startUtcMinute: 0, endUtcMinute: 1439 });
    const queue = makeQueueStub();
    const { audit } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const { enqueue } = await service.dispatch(prisma.stub as never, {
      topic: Topic.BILL_ISSUED,
      recipientId: 'user_1',
      data: { amount: 100, currency: 'VND' },
    });
    await enqueue();
    expect(queue.adds).toHaveLength(0);
    expect(prisma.rows[0]?.failureReason).toBe('email channel muted by user preference');
  });
});

// ---- NotificationsSendWorker --------------------------------------

interface PushSubscriptionTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function makePushSubscriptionsStub(opts: { targets?: PushSubscriptionTarget[] } = {}) {
  const targets = opts.targets ?? [];
  const deleted: string[] = [];
  return {
    listForRecipient: vi.fn(() => Promise.resolve(targets)),
    deleteByEndpoint: vi.fn((endpoint: string) => {
      deleted.push(endpoint);
      return Promise.resolve();
    }),
    _deleted: deleted,
  };
}

function makePushSenderStub(opts: { enabled?: boolean; outcomes?: Record<string, string> } = {}) {
  const enabled = opts.enabled ?? false;
  const outcomes = opts.outcomes ?? {};
  const sent: { endpoint: string; payload: unknown }[] = [];
  return {
    enabled,
    send: vi.fn((target: PushSubscriptionTarget, payload: unknown) => {
      sent.push({ endpoint: target.endpoint, payload });
      const outcome = outcomes[target.endpoint] ?? 'sent';
      if (outcome === 'gone') {
        return Promise.resolve({ status: 'gone', statusCode: 410, reason: 'Gone' });
      }
      if (outcome === 'error') {
        return Promise.resolve({ status: 'error', statusCode: 500, reason: 'boom' });
      }
      return Promise.resolve({ status: 'sent', statusCode: 201 });
    }),
    _sent: sent,
  };
}

function makeMailer(): MailerService & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  const mailer = {
    send: vi.fn((input: { to: string; subject: string }) => {
      sent.push({ to: input.to, subject: input.subject });
      return Promise.resolve();
    }),
    isLive: vi.fn(() => true),
    sent,
  };
  return mailer as unknown as MailerService & { sent: { to: string; subject: string }[] };
}

describe('NotificationsSendWorker.process', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let mailer: ReturnType<typeof makeMailer>;
  let worker: NotificationsSendWorker;

  beforeEach(() => {
    prisma = makePrismaStub();
    mailer = makeMailer();
    worker = new NotificationsSendWorker(
      prisma.stub as never,
      mailer,
      makePushSubscriptionsStub() as never,
      makePushSenderStub() as never,
    );
  });

  function seed(
    extra: Partial<{
      sentAt: Date;
      _userEmail: string | null;
      _userLocale: string;
      topic: string;
    }> = {},
  ) {
    const row = {
      id: 'notif_seed_1',
      userId: 'user_1',
      channel: 'EMAIL' as const,
      topic: extra.topic ?? Topic.BILL_ISSUED,
      title: 'Your rent for 2026-06 is due 2026-06-08',
      body: 'body',
      data: {
        amount: 500_000,
        currency: 'VND',
        dueDate: '2026-06-08',
        period: '2026-06',
      },
      readAt: null,
      sentAt: extra.sentAt ?? null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(extra._userEmail !== undefined && { _userEmail: extra._userEmail }),
      ...(extra._userLocale !== undefined && { _userLocale: extra._userLocale }),
    };
    prisma.rows.push(row);
    return row;
  }

  it('sends the email via Mailer, marks the row sentAt, returns "sent"', async () => {
    const row = seed();
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ status: 'sent' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain('2026-06-08');
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.sentAt).toBeInstanceOf(Date);
  });

  it('returns "not-found" for a missing notification id', async () => {
    const result = await worker.process({
      name: 'send',
      data: { notificationId: 'nope' },
    } as never);
    expect(result).toEqual({ status: 'not-found' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns "already-sent" if sentAt is already set (idempotent retry)', async () => {
    const row = seed({ sentAt: new Date() });
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toEqual({ status: 'already-sent' });
    expect(mailer.sent).toHaveLength(0);
  });

  it('returns "no-email" and skips send when the user has no email', async () => {
    const row = seed({ _userEmail: null });
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toEqual({ status: 'no-email' });
    expect(mailer.sent).toHaveLength(0);
    // No failureReason set: missing-email is structural, not a delivery
    // failure ops should grep for.
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.failureReason).toBeNull();
  });

  it('returns "skipped" for unknown job names', async () => {
    const result = await worker.process({
      name: 'unknown',
      data: { notificationId: 'whatever' },
    } as never);
    expect(result).toEqual({ status: 'skipped' });
  });

  it("re-renders the email in the recipient's current locale (Phase 11.5)", async () => {
    // VI is the default; this test pins the user to EN and asserts
    // the worker uses the EN template even though the persisted row
    // carries an EN-looking title from an earlier render. The
    // important assertion is that the worker is the one picking the
    // language, so a locale flip between dispatch and send takes
    // effect.
    const row = seed({ _userLocale: 'en' });
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ status: 'sent' });
    expect(mailer.sent[0]?.subject).toContain('Your rent for');
  });

  it('renders the email in Vietnamese when the user is on vi', async () => {
    const row = seed({ _userLocale: 'vi' });
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ status: 'sent' });
    expect(mailer.sent[0]?.subject).toContain('Tiền thuê');
  });
});

// ---- Phase 10.5 — push fanout -------------------------------------

describe('NotificationsSendWorker push fanout', () => {
  function seedRow(prisma: ReturnType<typeof makePrismaStub>) {
    const row = {
      id: 'notif_push_1',
      userId: 'user_1',
      channel: 'EMAIL' as const,
      topic: Topic.BILL_ISSUED,
      title: 'Your bill is ready',
      body: 'body',
      data: { amount: 100, currency: 'VND' },
      readAt: null,
      sentAt: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.rows.push(row);
    return row;
  }

  it('fans out push to every active subscription when enabled', async () => {
    const prisma = makePrismaStub();
    const row = seedRow(prisma);
    const subs = makePushSubscriptionsStub({
      targets: [
        { id: 'sub_a', endpoint: 'https://push/a', p256dh: 'p1', auth: 'a1' },
        { id: 'sub_b', endpoint: 'https://push/b', p256dh: 'p2', auth: 'a2' },
      ],
    });
    const sender = makePushSenderStub({ enabled: true });
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      makeMailer(),
      subs as never,
      sender as never,
    );
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ status: 'sent', pushDelivered: 2, pushPruned: 0 });
    expect(sender._sent.map((s) => s.endpoint)).toEqual(['https://push/a', 'https://push/b']);
  });

  it('skips push fanout when scope=PUSH muted=true', async () => {
    const prisma = makePrismaStub();
    const row = seedRow(prisma);
    const prefStub = prisma.stub.notificationPreference as {
      findUnique: ReturnType<typeof vi.fn>;
    };
    prefStub.findUnique.mockResolvedValueOnce({ muted: true });
    const subs = makePushSubscriptionsStub({
      targets: [{ id: 'sub_a', endpoint: 'https://push/a', p256dh: 'p1', auth: 'a1' }],
    });
    const sender = makePushSenderStub({ enabled: true });
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      makeMailer(),
      subs as never,
      sender as never,
    );
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ status: 'sent', pushDelivered: 0, pushPruned: 0 });
    expect(sender._sent).toHaveLength(0);
  });

  it('prunes the subscription on 410 Gone', async () => {
    const prisma = makePrismaStub();
    const row = seedRow(prisma);
    const subs = makePushSubscriptionsStub({
      targets: [
        { id: 'sub_a', endpoint: 'https://push/a', p256dh: 'p1', auth: 'a1' },
        { id: 'sub_b', endpoint: 'https://push/b', p256dh: 'p2', auth: 'a2' },
      ],
    });
    const sender = makePushSenderStub({
      enabled: true,
      outcomes: { 'https://push/a': 'gone' },
    });
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      makeMailer(),
      subs as never,
      sender as never,
    );
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ pushDelivered: 1, pushPruned: 1 });
    expect(subs._deleted).toEqual(['https://push/a']);
  });

  it('no-op when sender is disabled (no VAPID keys)', async () => {
    const prisma = makePrismaStub();
    const row = seedRow(prisma);
    const subs = makePushSubscriptionsStub({
      targets: [{ id: 'sub_a', endpoint: 'https://push/a', p256dh: 'p1', auth: 'a1' }],
    });
    const sender = makePushSenderStub({ enabled: false });
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      makeMailer(),
      subs as never,
      sender as never,
    );
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ pushDelivered: 0, pushPruned: 0 });
    expect(sender._sent).toHaveLength(0);
    // The subscription lookup is skipped entirely when disabled.
    expect(subs.listForRecipient).not.toHaveBeenCalled();
  });

  it('error from push provider logs but does not prune', async () => {
    const prisma = makePrismaStub();
    const row = seedRow(prisma);
    const subs = makePushSubscriptionsStub({
      targets: [{ id: 'sub_a', endpoint: 'https://push/a', p256dh: 'p1', auth: 'a1' }],
    });
    const sender = makePushSenderStub({
      enabled: true,
      outcomes: { 'https://push/a': 'error' },
    });
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      makeMailer(),
      subs as never,
      sender as never,
    );
    const result = await worker.process({
      name: 'send',
      data: { notificationId: row.id },
    } as never);
    expect(result).toMatchObject({ pushDelivered: 0, pushPruned: 0 });
    expect(subs._deleted).toHaveLength(0);
  });
});

describe('NotificationsSendWorker.onFailed', () => {
  it('sets failureReason on the row once attemptsMade equals opts.attempts', async () => {
    const prisma = makePrismaStub();
    const mailer = makeMailer();
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      mailer,
      makePushSubscriptionsStub() as never,
      makePushSenderStub() as never,
    );
    const row = {
      id: 'notif_failed_1',
      userId: 'user_x',
      topic: Topic.BILL_ISSUED,
      sentAt: null,
      failureReason: null,
    };
    prisma.rows.push(row);

    await worker.onFailed(
      {
        data: { notificationId: row.id },
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as never,
      new Error('SMTP 421'),
    );
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.failureReason).toBe('SMTP 421');
  });

  it('does NOT set failureReason while retries remain', async () => {
    const prisma = makePrismaStub();
    const mailer = makeMailer();
    const worker = new NotificationsSendWorker(
      prisma.stub as never,
      mailer,
      makePushSubscriptionsStub() as never,
      makePushSenderStub() as never,
    );
    const row = {
      id: 'notif_pending_retry',
      userId: 'user_x',
      topic: Topic.BILL_ISSUED,
      sentAt: null,
      failureReason: null,
    };
    prisma.rows.push(row);

    await worker.onFailed(
      {
        data: { notificationId: row.id },
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as never,
      new Error('SMTP 421'),
    );
    const after = prisma.rows.find((r) => r.id === row.id);
    expect(after?.failureReason).toBeNull();
  });
});

// ---- Template renderers -------------------------------------------

describe('renderNotification', () => {
  it.each([
    [Topic.BILL_ISSUED, 'rent'],
    [Topic.BILL_PAID, 'Payment received'],
    [Topic.BILL_REFUNDED, 'Refund issued'],
    [Topic.TICKET_OPENED, 'New ticket'],
    [Topic.TICKET_RESOLVED, 'resolved'],
    [Topic.JOB_COMPLETED, 'completed'],
    [Topic.PAYOUT_DISBURSED, 'Payout sent'],
  ])('%s renders an EN title containing %s when locale=en', (topic, marker) => {
    const r = renderNotification(
      topic,
      {
        amount: 100,
        currency: 'VND',
        dueDate: '2026-06-08',
        period: '2026-06',
        provider: 'STRIPE',
        ticketTitle: 'Leak',
        tenantName: 'Alice',
        partnerName: 'Bob',
        finalAmount: 200,
        reference: 'TXN-001',
      },
      'en',
    );
    expect(r.title.toLowerCase()).toContain(marker.toLowerCase());
    expect(r.emailHtml).toContain('<!doctype html>');
    // HTML must be escaped: no raw `<script>` even if data injected.
    expect(r.emailHtml).not.toContain('<script>');
  });

  it.each([
    [Topic.BILL_ISSUED, 'tiền thuê'],
    [Topic.BILL_PAID, 'đã nhận thanh toán'],
    [Topic.BILL_REFUNDED, 'đã hoàn tiền'],
    [Topic.TICKET_OPENED, 'yêu cầu mới'],
    [Topic.TICKET_RESOLVED, 'đã được giải quyết'],
    [Topic.JOB_COMPLETED, 'đã hoàn thành'],
    [Topic.PAYOUT_DISBURSED, 'đã chuyển khoản'],
  ])('%s renders a VI title containing %s when locale=vi', (topic, marker) => {
    const r = renderNotification(
      topic,
      {
        amount: 100,
        currency: 'VND',
        dueDate: '2026-06-08',
        period: '2026-06',
        provider: 'STRIPE',
        ticketTitle: 'Leak',
        tenantName: 'Alice',
        partnerName: 'Bob',
        finalAmount: 200,
        reference: 'TXN-001',
      },
      'vi',
    );
    expect(r.title.toLowerCase()).toContain(marker.toLowerCase());
    expect(r.emailHtml).toContain('<!doctype html>');
  });

  it('defaults to vi when no locale is supplied (Phase 11 default)', () => {
    const r = renderNotification(Topic.BILL_ISSUED, {
      amount: 100,
      currency: 'VND',
      dueDate: '2026-06-08',
      period: '2026-06',
    });
    expect(r.title).toContain('Tiền thuê');
  });

  it('escapes html-dangerous characters in user-controlled fields', () => {
    const r = renderNotification(
      Topic.TICKET_OPENED,
      {
        ticketTitle: '<script>alert(1)</script>',
        tenantName: 'Eve & friends',
      },
      'en',
    );
    expect(r.emailHtml).not.toContain('<script>alert(1)</script>');
    expect(r.emailHtml).toContain('&lt;script&gt;');
    expect(r.emailHtml).toContain('Eve &amp; friends');
  });
});

// ---- msUntilQuietHoursEnd helper (phase 10.4) --------------------

describe('msUntilQuietHoursEnd', () => {
  it('returns 0 when now is outside a non-wrapping window', () => {
    const now = new Date('2026-05-23T03:00:00Z');
    expect(msUntilQuietHoursEnd(now, 12 * 60, 18 * 60)).toBe(0);
  });

  it('returns ms to end when now is inside a non-wrapping window', () => {
    const now = new Date('2026-05-23T13:00:00Z');
    expect(msUntilQuietHoursEnd(now, 12 * 60, 18 * 60)).toBe(5 * 60 * 60_000);
  });

  it('handles wrap-around window when now is past midnight', () => {
    const now = new Date('2026-05-23T02:00:00Z');
    // window 22:00..08:00 — we're 6 hours from end (08:00).
    expect(msUntilQuietHoursEnd(now, 22 * 60, 8 * 60)).toBe(6 * 60 * 60_000);
  });

  it('handles wrap-around window when now is before midnight', () => {
    const now = new Date('2026-05-23T23:00:00Z');
    // window 22:00..08:00 — 9 hours from end (next day 08:00).
    expect(msUntilQuietHoursEnd(now, 22 * 60, 8 * 60)).toBe(9 * 60 * 60_000);
  });

  it('handles wrap-around window when now is outside the wrap', () => {
    const now = new Date('2026-05-23T10:00:00Z');
    expect(msUntilQuietHoursEnd(now, 22 * 60, 8 * 60)).toBe(0);
  });

  it('subtracts the sub-minute portion of now so the delay aligns with wall clock', () => {
    const now = new Date('2026-05-23T13:30:30.500Z');
    // window 12:00..14:00 — 30 min - 30.5s remain.
    const expected = 30 * 60_000 - (30 * 1000 + 500);
    expect(msUntilQuietHoursEnd(now, 12 * 60, 14 * 60)).toBe(expected);
  });
});

// ---- NotificationsService.sweepStuck (phase 10.2) -----------------

interface StuckRowSeed {
  id: string;
  userId?: string;
  topic?: string;
  sentAt?: Date | null;
  failureReason?: string | null;
  retryCount?: number;
  createdAt: Date;
}

function makeSweepPrismaStub(seeds: StuckRowSeed[]) {
  const rows = seeds.map((s) => ({
    id: s.id,
    userId: s.userId ?? 'user_1',
    topic: s.topic ?? Topic.BILL_ISSUED,
    sentAt: s.sentAt ?? null,
    failureReason: s.failureReason ?? null,
    retryCount: s.retryCount ?? 0,
    lastAttemptAt: null as Date | null,
    createdAt: s.createdAt,
  }));

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    notification: {
      findMany: vi.fn(
        (args: {
          where: { sentAt: null; failureReason: null; createdAt: { lt: Date } };
          take: number;
          orderBy: { createdAt: 'asc' };
        }) => {
          const cutoff = args.where.createdAt.lt;
          const matched = rows
            .filter((r) => r.sentAt === null && r.failureReason === null && r.createdAt < cutoff)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, args.take)
            .map((r) => ({
              id: r.id,
              userId: r.userId,
              topic: r.topic,
              retryCount: r.retryCount,
              createdAt: r.createdAt,
            }));
          return Promise.resolve(matched);
        },
      ),
      findUnique: vi.fn(({ where }: { where: { id: string } }) => {
        const row = rows.find((r) => r.id === where.id);
        return Promise.resolve(row ?? null);
      }),
      update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, rows };
}

describe('NotificationsService.sweepStuck', () => {
  it('skips rows younger than the 1h floor', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const prisma = makeSweepPrismaStub([
      {
        id: 'fresh_1',
        // 30 minutes old — younger than SWEEP_MIN_AGE_MS.
        createdAt: new Date(now.getTime() - 30 * 60 * 1000),
      },
    ]);
    const queue = makeQueueStub();
    const { audit, calls } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const result = await service.sweepStuck(now);
    expect(result).toEqual({ inspected: 0, retried: 0, gaveUp: 0 });
    expect(queue.adds).toHaveLength(0);
    expect(calls).toHaveLength(0);
    // Row left untouched.
    expect(prisma.rows[0]?.retryCount).toBe(0);
    expect(prisma.rows[0]?.lastAttemptAt).toBeNull();
  });

  it('bumps retryCount + writes notification.sweep.retry audit + re-enqueues', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const prisma = makeSweepPrismaStub([
      {
        id: 'stuck_1',
        // 90 minutes old — over the floor.
        createdAt: new Date(now.getTime() - 90 * 60 * 1000),
      },
    ]);
    const queue = makeQueueStub();
    const { audit, calls } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const result = await service.sweepStuck(now);
    expect(result).toEqual({ inspected: 1, retried: 1, gaveUp: 0 });
    expect(prisma.rows[0]?.retryCount).toBe(1);
    expect(prisma.rows[0]?.lastAttemptAt).toEqual(now);
    expect(queue.adds).toHaveLength(1);
    expect(queue.adds[0]).toMatchObject({
      name: 'send',
      data: { notificationId: 'stuck_1' },
      opts: { attempts: 1 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actorId: null,
      action: 'notification.sweep.retry',
      target: 'Notification:stuck_1',
      meta: { retryCount: 1 },
    });
  });

  it('marks the row stuck + writes the give-up audit once retryCount hits the cap', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const prisma = makeSweepPrismaStub([
      {
        id: 'tried_max',
        // Already retried SWEEP_MAX_RETRIES times — the next sweep
        // visit should finalize, not enqueue.
        retryCount: SWEEP_MAX_RETRIES,
        createdAt: new Date(now.getTime() - SWEEP_MIN_AGE_MS - 60_000),
      },
    ]);
    const queue = makeQueueStub();
    const { audit, calls } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const result = await service.sweepStuck(now);
    expect(result).toEqual({ inspected: 1, retried: 0, gaveUp: 1 });
    expect(prisma.rows[0]?.failureReason).toBe('sweep gave up after 3 retries');
    expect(prisma.rows[0]?.lastAttemptAt).toEqual(now);
    // retryCount is NOT bumped on the give-up path — only failureReason
    // moves. Keeps the counter meaning "successful re-enqueues".
    expect(prisma.rows[0]?.retryCount).toBe(SWEEP_MAX_RETRIES);
    expect(queue.adds).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      actorId: null,
      action: 'notification.sweep.give-up',
      target: 'Notification:tried_max',
    });
  });

  it('skips rows the worker finalized between query + tx (race)', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const prisma = makeSweepPrismaStub([
      {
        id: 'raced_1',
        createdAt: new Date(now.getTime() - 90 * 60 * 1000),
      },
    ]);
    // Simulate: findMany returns the row, then findUnique inside the tx
    // sees sentAt populated (worker won the race).
    const fu = prisma.stub.notification as { findUnique: ReturnType<typeof vi.fn> };
    fu.findUnique.mockImplementationOnce(() =>
      Promise.resolve({
        id: 'raced_1',
        sentAt: new Date(now.getTime() - 1000),
        failureReason: null,
        retryCount: 0,
      }),
    );

    const queue = makeQueueStub();
    const { audit, calls } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never, audit);

    const result = await service.sweepStuck(now);
    expect(result).toEqual({ inspected: 1, retried: 0, gaveUp: 0 });
    expect(queue.adds).toHaveLength(0);
    expect(calls).toHaveLength(0);
    // Counter never moved because the tx bailed early.
    expect(prisma.rows[0]?.retryCount).toBe(0);
  });

  it('swallows a queue.add failure so the counter bump survives', async () => {
    const now = new Date('2026-05-23T12:00:00Z');
    const prisma = makeSweepPrismaStub([
      {
        id: 'flaky_redis',
        createdAt: new Date(now.getTime() - 90 * 60 * 1000),
      },
    ]);
    const queue = {
      add: vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    };
    const { audit, calls } = makeAuditStub();
    const service = new NotificationsService(prisma.stub as never, queue as never, audit);

    const result = await service.sweepStuck(now);
    // The tx committed → audit row + counter bump persisted, but we
    // don't claim a retry succeeded because the enqueue threw.
    expect(result.inspected).toBe(1);
    expect(result.retried).toBe(0);
    expect(result.gaveUp).toBe(0);
    expect(prisma.rows[0]?.retryCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.action).toBe('notification.sweep.retry');
  });
});
