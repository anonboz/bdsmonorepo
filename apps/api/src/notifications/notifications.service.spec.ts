import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsService } from './notifications.service.js';
import { renderNotification } from './notifications.templates.js';
import { NotificationsSendWorker } from './notifications.worker.js';
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
          ...data,
          readAt: null,
          sentAt: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
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
            const overlay = row as { _userEmail?: string | null };
            const email =
              '_userEmail' in overlay ? (overlay._userEmail ?? null) : 'tenant@example.com';
            return Promise.resolve({ ...row, user: { email } });
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

// ---- NotificationsService.dispatch ---------------------------------

describe('NotificationsService.dispatch', () => {
  it('persists a row with the topic renderer title + body, then post-commit enqueues', async () => {
    const prisma = makePrismaStub();
    const queue = makeQueueStub();
    const service = new NotificationsService(prisma.stub as never, queue.queue as never);

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
    const service = new NotificationsService(prisma.stub as never, queue as never);
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
    const service = new NotificationsService(prisma.stub as never, queue.queue as never);

    const id = await service.dispatchAndEnqueue({
      topic: Topic.TICKET_OPENED,
      recipientId: 'owner_9',
      data: { ticketTitle: 'leak', tenantName: 'Alice' },
    });
    expect(id).toBe(prisma.rows[0]?.id);
    expect(queue.adds).toHaveLength(1);
  });
});

// ---- NotificationsSendWorker --------------------------------------

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
    worker = new NotificationsSendWorker(prisma.stub as never, mailer);
  });

  function seed(extra: Partial<{ sentAt: Date; _userEmail: string | null; topic: string }> = {}) {
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
    expect(result).toEqual({ status: 'sent' });
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
});

describe('NotificationsSendWorker.onFailed', () => {
  it('sets failureReason on the row once attemptsMade equals opts.attempts', async () => {
    const prisma = makePrismaStub();
    const mailer = makeMailer();
    const worker = new NotificationsSendWorker(prisma.stub as never, mailer);
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
    const worker = new NotificationsSendWorker(prisma.stub as never, mailer);
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
  ])('%s renders a title containing %s', (topic, marker) => {
    const r = renderNotification(topic, {
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
    });
    expect(r.title.toLowerCase()).toContain(marker.toLowerCase());
    expect(r.emailHtml).toContain('<!doctype html>');
    // HTML must be escaped: no raw `<script>` even if data injected.
    expect(r.emailHtml).not.toContain('<script>');
  });

  it('escapes html-dangerous characters in user-controlled fields', () => {
    const r = renderNotification(Topic.TICKET_OPENED, {
      ticketTitle: '<script>alert(1)</script>',
      tenantName: 'Eve & friends',
    });
    expect(r.emailHtml).not.toContain('<script>alert(1)</script>');
    expect(r.emailHtml).toContain('&lt;script&gt;');
    expect(r.emailHtml).toContain('Eve &amp; friends');
  });
});
