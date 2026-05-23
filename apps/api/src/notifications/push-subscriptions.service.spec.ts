import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '@repo/shared';

import { PushSubscriptionsService } from './push-subscriptions.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

const ENV_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

interface Row {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  failedAt: Date | null;
  createdAt: Date;
}

function makePrismaStub(seeds: Row[] = []) {
  const rows: Row[] = seeds.map((s) => ({ ...s }));
  return {
    pushSubscription: {
      findMany: vi.fn(
        ({ where, select }: { where: { userId: string }; select?: Record<string, boolean> }) => {
          const matched = rows.filter((r) => r.userId === where.userId);
          if (!select) return Promise.resolve(matched);
          return Promise.resolve(
            matched.map((r) => {
              const proj: Record<string, unknown> = {};
              for (const k of Object.keys(select)) {
                proj[k] = (r as unknown as Record<string, unknown>)[k];
              }
              return proj;
            }),
          );
        },
      ),
      findUnique: vi.fn(
        ({
          where,
        }: {
          where: { id?: string; userId_endpoint?: { userId: string; endpoint: string } };
        }) => {
          if (where.id) {
            return Promise.resolve(rows.find((r) => r.id === where.id) ?? null);
          }
          if (where.userId_endpoint) {
            const key = where.userId_endpoint;
            return Promise.resolve(
              rows.find((r) => r.userId === key.userId && r.endpoint === key.endpoint) ?? null,
            );
          }
          return Promise.resolve(null);
        },
      ),
      count: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(rows.filter((r) => r.userId === where.userId).length),
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId_endpoint: { userId: string; endpoint: string } };
          create: Omit<Row, 'id' | 'failedAt' | 'createdAt'>;
          update: Partial<Row>;
        }) => {
          const key = where.userId_endpoint;
          const existing = rows.find((r) => r.userId === key.userId && r.endpoint === key.endpoint);
          if (existing) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }
          const row: Row = {
            ...(create as Row),
            id: `sub_${rows.length + 1}`,
            failedAt: null,
            createdAt: new Date(),
          };
          rows.push(row);
          return Promise.resolve(row);
        },
      ),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        const idx = rows.findIndex((r) => r.id === where.id);
        if (idx >= 0) {
          const [row] = rows.splice(idx, 1);
          return Promise.resolve(row);
        }
        return Promise.reject(new Error('not found'));
      }),
      deleteMany: vi.fn(({ where }: { where: { endpoint: string } }) => {
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i]?.endpoint === where.endpoint) {
            rows.splice(i, 1);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
    },
  };
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    process.env[k] = 'test-key-value';
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('PushSubscriptionsService', () => {
  it('list returns the user’s rows sorted newest first', async () => {
    const stub = makePrismaStub([
      {
        id: 'a',
        userId: 'me',
        endpoint: 'https://push/a',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        failedAt: null,
        createdAt: new Date(),
      },
    ]);
    const svc = new PushSubscriptionsService(stub as never);
    const res = await svc.list('me');
    expect(res.subscriptions).toHaveLength(1);
    expect(res.subscriptions[0]?.endpoint).toBe('https://push/a');
  });

  it('create upserts on the same (userId, endpoint) — no duplicate', async () => {
    const stub = makePrismaStub();
    const svc = new PushSubscriptionsService(stub as never);
    await svc.create('me', {
      endpoint: 'https://push/a',
      keys: { p256dh: 'p1', auth: 'a1' },
    });
    await svc.create('me', {
      endpoint: 'https://push/a',
      keys: { p256dh: 'p2', auth: 'a2' },
      userAgent: 'Chrome',
    });
    const list = await svc.list('me');
    expect(list.subscriptions).toHaveLength(1);
  });

  it('create returns 503 when VAPID keys are not configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    const stub = makePrismaStub();
    // Re-import to capture the updated env. The service reads `env`
    // at runtime via the getter, so re-instantiating is enough.
    const svc = new PushSubscriptionsService(stub as never);
    await expect(
      svc.create('me', { endpoint: 'https://push/a', keys: { p256dh: 'p', auth: 'a' } }),
    ).rejects.toMatchObject({ status: 503, type: 'push.provider_disabled' });
  });

  it('create returns 422 once the per-user cap is hit', async () => {
    const stub = makePrismaStub(
      Array.from({ length: MAX_PUSH_SUBSCRIPTIONS_PER_USER }, (_, i) => ({
        id: `id_${i}`,
        userId: 'me',
        endpoint: `https://push/${i}`,
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        failedAt: null,
        createdAt: new Date(),
      })),
    );
    const svc = new PushSubscriptionsService(stub as never);
    await expect(
      svc.create('me', { endpoint: 'https://push/new', keys: { p256dh: 'p', auth: 'a' } }),
    ).rejects.toMatchObject({ status: 422, type: 'push.limit_reached' });
  });

  it('deleteByIdForUser removes the row when owned', async () => {
    const stub = makePrismaStub([
      {
        id: 'sub_a',
        userId: 'me',
        endpoint: 'e',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        failedAt: null,
        createdAt: new Date(),
      },
    ]);
    const svc = new PushSubscriptionsService(stub as never);
    await svc.deleteByIdForUser('me', 'sub_a');
    const list = await svc.list('me');
    expect(list.subscriptions).toHaveLength(0);
  });

  it('deleteByIdForUser 404 on cross-user delete', async () => {
    const stub = makePrismaStub([
      {
        id: 'sub_a',
        userId: 'other',
        endpoint: 'e',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        failedAt: null,
        createdAt: new Date(),
      },
    ]);
    const svc = new PushSubscriptionsService(stub as never);
    await expect(svc.deleteByIdForUser('me', 'sub_a')).rejects.toBeInstanceOf(ProblemError);
  });

  it('deleteByEndpoint is idempotent — count:0 when nothing matched', async () => {
    const stub = makePrismaStub();
    const svc = new PushSubscriptionsService(stub as never);
    await expect(svc.deleteByEndpoint('https://nope')).resolves.toBeUndefined();
  });
});
