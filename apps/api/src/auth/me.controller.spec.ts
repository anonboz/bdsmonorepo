import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Locale } from '@repo/shared';

import type { AuthenticatedUser } from './auth.types.js';
import { MeController } from './me.controller.js';
import type { PasswordService } from './password.service.js';
import type { AuditLogger } from '../common/audit/audit-logger.service.js';
import type { PrismaInstance } from '../common/prisma/prisma.token.js';

interface UserRow {
  id: string;
  locale: string;
}

function makePrismaStub(initial: UserRow) {
  const row = { ...initial };
  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    user: {
      update: vi.fn(({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
        if (where.id !== row.id) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub: stub as unknown as PrismaInstance, row };
}

function makeAuditStub() {
  const writes: { action: string; target: string | null | undefined; meta: unknown }[] = [];
  const record = (entry: {
    action: string;
    target?: string | null;
    meta?: Record<string, unknown> | null;
  }) => {
    writes.push({ action: entry.action, target: entry.target, meta: entry.meta });
    return Promise.resolve();
  };
  const audit = {
    write: vi.fn((_tx: unknown, entry: Parameters<typeof record>[0]) => record(entry)),
    // Mirrors the real AuditLogger.writeOnce, which is write() without a tx.
    writeOnce: vi.fn((entry: Parameters<typeof record>[0]) => record(entry)),
  } as unknown as AuditLogger;
  return { audit, writes };
}

function makePasswordStub(hasPassword = false) {
  const setCalls: { newPassword: string }[] = [];
  const service = {
    hasPassword: vi.fn(() => Promise.resolve(hasPassword)),
    setPassword: vi.fn((_headers: Headers, newPassword: string) => {
      setCalls.push({ newPassword });
      return Promise.resolve();
    }),
  } as unknown as PasswordService;
  return { service, setCalls };
}

function makeReply() {
  const cookies: { name: string; value: string; opts: Record<string, unknown> }[] = [];
  const reply = {
    setCookie: vi.fn((name: string, value: string, opts: Record<string, unknown>) => {
      cookies.push({ name, value, opts });
      return reply;
    }),
  } as unknown as Parameters<MeController['update']>[3];
  return { reply, cookies };
}

const baseUser: AuthenticatedUser = {
  id: 'user_1',
  email: 'me@example.com',
  phone: null,
  displayName: 'Me',
  roles: ['TENANT'],
  isSuspended: false,
  locale: Locale.vi,
};

const req = {
  ip: '127.0.0.1',
  headers: { 'user-agent': 'vitest' },
} as unknown as Parameters<MeController['update']>[2];

describe('MeController.update', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let audit: ReturnType<typeof makeAuditStub>;
  let controller: MeController;

  beforeEach(() => {
    prisma = makePrismaStub({ id: baseUser.id, locale: baseUser.locale });
    audit = makeAuditStub();
    controller = new MeController(prisma.stub, audit.audit, makePasswordStub().service);
  });

  it('updates the locale, writes an audit row, and sets the cookie on the response', async () => {
    const { reply, cookies } = makeReply();
    const res = await controller.update(baseUser, { locale: Locale.en }, req, reply);

    expect(res.user.locale).toBe(Locale.en);
    expect(prisma.row.locale).toBe(Locale.en);

    const cookie = cookies.find((c) => c.name === 'bds-locale');
    expect(cookie?.value).toBe(Locale.en);
    expect(cookie?.opts.sameSite).toBe('lax');
    expect(cookie?.opts.path).toBe('/');
    expect(cookie?.opts.maxAge).toBeGreaterThan(0);

    expect(audit.writes).toHaveLength(1);
    expect(audit.writes[0]?.action).toBe('user.locale.update');
    expect(audit.writes[0]?.target).toBe(`User:${baseUser.id}`);
    expect(audit.writes[0]?.meta).toEqual({ from: Locale.vi, to: Locale.en });
  });

  it('is idempotent when the locale already matches — no write, no audit row, but the cookie is still set', async () => {
    const { reply, cookies } = makeReply();
    const res = await controller.update(baseUser, { locale: Locale.vi }, req, reply);

    expect(res.user.locale).toBe(Locale.vi);
    expect(prisma.row.locale).toBe(Locale.vi);
    expect(audit.writes).toHaveLength(0);
    // Cookie still set so a stale cookie value gets corrected.
    expect(cookies.find((c) => c.name === 'bds-locale')?.value).toBe(Locale.vi);
  });
});

describe('MeController.me', () => {
  it('reflects whether the user has a password', async () => {
    const prisma = makePrismaStub({ id: baseUser.id, locale: baseUser.locale });
    const audit = makeAuditStub();

    const withPw = new MeController(prisma.stub, audit.audit, makePasswordStub(true).service);
    expect((await withPw.me(baseUser)).hasPassword).toBe(true);

    const withoutPw = new MeController(prisma.stub, audit.audit, makePasswordStub(false).service);
    expect((await withoutPw.me(baseUser)).hasPassword).toBe(false);
  });
});

describe('MeController.setPassword', () => {
  it('forwards the new password to the service and writes an audit row', async () => {
    const prisma = makePrismaStub({ id: baseUser.id, locale: baseUser.locale });
    const audit = makeAuditStub();
    const password = makePasswordStub();
    const controller = new MeController(prisma.stub, audit.audit, password.service);

    await controller.setPassword(baseUser, { newPassword: 'Passw0rd!23' }, req);

    expect(password.setCalls).toEqual([{ newPassword: 'Passw0rd!23' }]);
    expect(audit.writes).toHaveLength(1);
    expect(audit.writes[0]?.action).toBe('auth.password.set');
    expect(audit.writes[0]?.target).toBe(`User:${baseUser.id}`);
  });
});
