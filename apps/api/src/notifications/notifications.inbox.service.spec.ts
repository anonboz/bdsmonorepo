import { describe, expect, it, vi } from 'vitest';

import { NotificationsInboxService } from './notifications.inbox.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

interface Seed {
  id: string;
  userId: string;
  topic: string;
  title: string;
  body?: string | null;
  readAt?: Date | null;
  sentAt?: Date | null;
  failureReason?: string | null;
  createdAt?: Date;
}

function makePrismaStub(seeds: Seed[]) {
  const rows = seeds.map((s, i) => ({
    id: s.id,
    userId: s.userId,
    channel: 'EMAIL' as const,
    topic: s.topic,
    title: s.title,
    body: s.body ?? 'body',
    data: null,
    readAt: s.readAt ?? null,
    sentAt: s.sentAt ?? null,
    failureReason: s.failureReason ?? null,
    // Stable createdAt offsets so cursor pagination is deterministic.
    createdAt: s.createdAt ?? new Date(2026, 4, 21, 12, 0, i),
  }));

  const stub: Record<string, unknown> = {
    notification: {
      findUnique: vi.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      ),
      findMany: vi.fn(
        ({
          where,
          take,
          orderBy,
          cursor,
          skip,
        }: {
          where: { userId: string; readAt?: null };
          take: number;
          orderBy: { createdAt?: 'asc' | 'desc'; id?: 'asc' | 'desc' }[];
          cursor?: { id: string };
          skip?: number;
        }) => {
          let filtered = rows.filter((r) => {
            if (r.userId !== where.userId) return false;
            if (where.readAt === null && r.readAt != null) return false;
            return true;
          });
          const dir = orderBy[0]?.createdAt ?? 'desc';
          filtered = filtered.sort((a, b) => {
            const cmp = a.createdAt.getTime() - b.createdAt.getTime();
            return dir === 'asc' ? cmp : -cmp;
          });
          if (cursor) {
            const idx = filtered.findIndex((r) => r.id === cursor.id);
            if (idx >= 0) filtered = filtered.slice(idx + (skip ?? 0));
          }
          return Promise.resolve(filtered.slice(0, take));
        },
      ),
      update: vi.fn(({ where, data }: { where: { id: string }; data: { readAt: Date } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        row.readAt = data.readAt;
        return Promise.resolve(row);
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: { userId: string; readAt: null }; data: { readAt: Date } }) => {
          let count = 0;
          for (const r of rows) {
            if (r.userId === where.userId && r.readAt === null) {
              r.readAt = data.readAt;
              count++;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      count: vi.fn(({ where }: { where: { userId: string; readAt: null } }) =>
        Promise.resolve(rows.filter((r) => r.userId === where.userId && r.readAt === null).length),
      ),
    },
  };
  return { stub, rows };
}

describe('NotificationsInboxService.listForUser', () => {
  it('returns only the caller’s rows, newest first by default', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a' },
      { id: 'b', userId: 'me', topic: 'bill.paid', title: 'b' },
      { id: 'c', userId: 'other', topic: 'bill.issued', title: 'c' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const page = await svc.listForUser('me', { limit: 20, sort: 'desc' });
    expect(page.items.map((r) => r.id)).toEqual(['b', 'a']);
    expect(page.nextCursor).toBeNull();
  });

  it('filters to unread when unread=true', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a', readAt: new Date() },
      { id: 'b', userId: 'me', topic: 'bill.paid', title: 'b' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const page = await svc.listForUser('me', { limit: 20, sort: 'desc', unread: true });
    expect(page.items.map((r) => r.id)).toEqual(['b']);
  });

  it('paginates with nextCursor when there are more rows than limit', async () => {
    const seeds = Array.from({ length: 5 }, (_, i) => ({
      id: `n${i}`,
      userId: 'me',
      topic: 'bill.issued',
      title: `t${i}`,
    }));
    const { stub } = makePrismaStub(seeds);
    const svc = new NotificationsInboxService(stub as never);
    const page = await svc.listForUser('me', { limit: 3, sort: 'desc' });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBe(page.items.at(-1)?.id);
  });
});

describe('NotificationsInboxService.getForUser', () => {
  it('returns the row when owned', async () => {
    const { stub } = makePrismaStub([{ id: 'a', userId: 'me', topic: 'bill.issued', title: 'a' }]);
    const svc = new NotificationsInboxService(stub as never);
    const row = await svc.getForUser('me', 'a');
    expect(row.id).toBe('a');
  });

  it('404 on cross-user access (existence-hiding)', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'other', topic: 'bill.issued', title: 'a' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    await expect(svc.getForUser('me', 'a')).rejects.toBeInstanceOf(ProblemError);
  });

  it('404 on missing id', async () => {
    const { stub } = makePrismaStub([]);
    const svc = new NotificationsInboxService(stub as never);
    await expect(svc.getForUser('me', 'nope')).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('NotificationsInboxService.markRead', () => {
  it('sets readAt on the first call', async () => {
    const { stub, rows } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const result = await svc.markRead('me', 'a');
    expect(result.readAt).not.toBeNull();
    expect(rows[0]?.readAt).toBeInstanceOf(Date);
  });

  it('is idempotent — second call returns the same readAt without writing', async () => {
    const initial = new Date(2026, 4, 20);
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a', readAt: initial },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const result = await svc.markRead('me', 'a');
    expect(result.readAt).toBe(initial.toISOString());
    // No update call was made — the helper returned the existing row.
    const update = stub.notification as { update: { mock: { calls: unknown[] } } };
    expect(update.update.mock.calls).toHaveLength(0);
  });

  it('404 on cross-user id', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'other', topic: 'bill.issued', title: 'a' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    await expect(svc.markRead('me', 'a')).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('NotificationsInboxService.markAllRead', () => {
  it('updates only the caller’s unread rows + returns the count', async () => {
    const { stub, rows } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a' },
      { id: 'b', userId: 'me', topic: 'bill.paid', title: 'b', readAt: new Date() },
      { id: 'c', userId: 'me', topic: 'ticket.opened', title: 'c' },
      { id: 'd', userId: 'other', topic: 'bill.issued', title: 'd' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const res = await svc.markAllRead('me');
    expect(res.updated).toBe(2);
    // 'd' belongs to another user — must stay untouched.
    expect(rows.find((r) => r.id === 'd')?.readAt).toBeNull();
  });

  it('returns updated:0 when nothing is unread', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a', readAt: new Date() },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const res = await svc.markAllRead('me');
    expect(res.updated).toBe(0);
  });
});

describe('NotificationsInboxService.unreadCount', () => {
  it('counts only unread rows for the caller', async () => {
    const { stub } = makePrismaStub([
      { id: 'a', userId: 'me', topic: 'bill.issued', title: 'a' },
      { id: 'b', userId: 'me', topic: 'bill.paid', title: 'b' },
      { id: 'c', userId: 'me', topic: 'ticket.opened', title: 'c', readAt: new Date() },
      { id: 'd', userId: 'other', topic: 'bill.issued', title: 'd' },
    ]);
    const svc = new NotificationsInboxService(stub as never);
    const res = await svc.unreadCount('me');
    expect(res.unread).toBe(2);
  });
});
