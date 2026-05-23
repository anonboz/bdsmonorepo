import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountErasureService } from './account-erasure.service.js';
import type { AdminUsersService } from '../admin/admin-users.service.js';
import type { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import type { MailerService } from '../common/mailer/mailer.service.js';
import type { PlatformConfigService } from '../platform/platform-config.service.js';

interface ErasureRow {
  userId: string;
  requestedAt: Date;
  executeAfter: Date;
  undoToken: string;
  cancelledAt: Date | null;
  completedAt: Date | null;
}

interface UserRow {
  id: string;
  email: string | null;
  deletedAt: Date | null;
}

function makePrismaStub(opts: { users?: UserRow[]; erasures?: ErasureRow[] } = {}) {
  const users: UserRow[] = opts.users ?? [{ id: 'me', email: 'me@example.com', deletedAt: null }];
  const erasures: ErasureRow[] = opts.erasures ?? [];

  const stub: Record<string, unknown> = {};
  Object.assign(stub, {
    user: {
      findUnique: vi.fn(
        ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
          const row = users.find((u) => u.id === where.id);
          if (!row) return Promise.resolve(null);
          if (select) {
            const proj: Record<string, unknown> = {};
            for (const k of Object.keys(select)) {
              proj[k] = (row as unknown as Record<string, unknown>)[k];
            }
            return Promise.resolve(proj);
          }
          return Promise.resolve(row);
        },
      ),
    },
    accountErasureRequest: {
      findUnique: vi.fn(({ where }: { where: { userId: string } }) =>
        Promise.resolve(erasures.find((r) => r.userId === where.userId) ?? null),
      ),
      findFirst: vi.fn(
        ({ where }: { where: { undoToken: string; cancelledAt: null; completedAt: null } }) => {
          const row = erasures.find(
            (r) =>
              r.undoToken === where.undoToken && r.cancelledAt === null && r.completedAt === null,
          );
          return Promise.resolve(row ?? null);
        },
      ),
      findMany: vi.fn(
        ({
          where,
        }: {
          where: {
            executeAfter: { lte: Date };
            cancelledAt: null;
            completedAt: null;
          };
        }) =>
          Promise.resolve(
            erasures.filter(
              (r) =>
                r.executeAfter <= where.executeAfter.lte &&
                r.cancelledAt === null &&
                r.completedAt === null,
            ),
          ),
      ),
      upsert: vi.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: Omit<ErasureRow, 'undoToken'> & { undoToken: string };
          update: Partial<ErasureRow>;
        }) => {
          const existing = erasures.find((r) => r.userId === where.userId);
          if (existing) {
            Object.assign(existing, update);
            return Promise.resolve(existing);
          }
          const row: ErasureRow = {
            userId: create.userId,
            requestedAt: create.requestedAt ?? new Date(),
            executeAfter: create.executeAfter,
            undoToken: create.undoToken,
            cancelledAt: null,
            completedAt: null,
          };
          erasures.push(row);
          return Promise.resolve(row);
        },
      ),
      update: vi.fn(({ where, data }: { where: { userId: string }; data: Partial<ErasureRow> }) => {
        const row = erasures.find((r) => r.userId === where.userId);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => Promise.resolve(fn(stub))),
  });
  return { stub, users, erasures };
}

function makeAdminStub() {
  return {
    performErasure: vi.fn(() => Promise.resolve({ id: 'me' })),
  } as unknown as AdminUsersService & { performErasure: ReturnType<typeof vi.fn> };
}

function makeAuditStub() {
  const calls: { action: string }[] = [];
  return {
    audit: {
      write: vi.fn((_tx: unknown, entry: { action: string }) => {
        calls.push({ action: entry.action });
        return Promise.resolve();
      }),
      writeOnce: vi.fn((entry: { action: string }) => {
        calls.push({ action: entry.action });
        return Promise.resolve();
      }),
    } as unknown as AuditLogger,
    calls,
  };
}

function makeMailerStub() {
  const sent: { to: string; subject: string }[] = [];
  return {
    mailer: {
      send: vi.fn((input: { to: string; subject: string }) => {
        sent.push({ to: input.to, subject: input.subject });
        return Promise.resolve();
      }),
    } as unknown as MailerService,
    sent,
  };
}

function makePlatformConfigStub(graceDays = 7) {
  return {
    get: vi.fn(() =>
      Promise.resolve({
        commissionBps: 1000,
        accountErasureGraceDays: graceDays,
        updatedAt: new Date().toISOString(),
      }),
    ),
  } as unknown as PlatformConfigService;
}

const ctx = { actorId: 'me', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('AccountErasureService.request', () => {
  let prisma: ReturnType<typeof makePrismaStub>;
  let admin: ReturnType<typeof makeAdminStub>;
  let audit: ReturnType<typeof makeAuditStub>;
  let mailer: ReturnType<typeof makeMailerStub>;
  let service: AccountErasureService;

  beforeEach(() => {
    prisma = makePrismaStub();
    admin = makeAdminStub();
    audit = makeAuditStub();
    mailer = makeMailerStub();
    service = new AccountErasureService(
      prisma.stub as never,
      admin,
      audit.audit,
      mailer.mailer,
      makePlatformConfigStub(7),
    );
  });

  it('schedules with executeAfter = now + graceDays and writes the audit + email', async () => {
    const before = Date.now();
    const res = await service.request('me', ctx);
    const after = Date.now();
    const executeMs = new Date(res.executeAfter).getTime();
    expect(executeMs).toBeGreaterThanOrEqual(before + 7 * 24 * 3600_000);
    expect(executeMs).toBeLessThanOrEqual(after + 7 * 24 * 3600_000 + 5_000);
    expect(prisma.erasures).toHaveLength(1);
    expect(audit.calls.map((c) => c.action)).toEqual(['account.erasure.requested']);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain('scheduled for deletion');
  });

  it('is idempotent — re-request on a pending row returns the same shape, no new email', async () => {
    const first = await service.request('me', ctx);
    const second = await service.request('me', ctx);
    expect(second.executeAfter).toBe(first.executeAfter);
    expect(prisma.erasures).toHaveLength(1);
    expect(mailer.sent).toHaveLength(1);
  });

  it('422 when the user has already been erased', async () => {
    prisma = makePrismaStub({
      users: [{ id: 'me', email: null, deletedAt: new Date() }],
    });
    service = new AccountErasureService(
      prisma.stub as never,
      admin,
      audit.audit,
      mailer.mailer,
      makePlatformConfigStub(7),
    );
    await expect(service.request('me', ctx)).rejects.toBeInstanceOf(ProblemError);
  });

  it('re-request after a cancel rotates the token + restarts the window', async () => {
    await service.request('me', ctx);
    await service.cancel('me', ctx);
    const firstToken = prisma.erasures[0]?.undoToken;
    const second = await service.request('me', ctx);
    expect(prisma.erasures[0]?.undoToken).not.toBe(firstToken);
    expect(prisma.erasures[0]?.cancelledAt).toBeNull();
    expect(second.cancelledAt).toBeNull();
    expect(mailer.sent.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AccountErasureService.cancel', () => {
  it('marks cancelledAt + sends the cancellation email', async () => {
    const prisma = makePrismaStub();
    const audit = makeAuditStub();
    const mailer = makeMailerStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      makeAdminStub(),
      audit.audit,
      mailer.mailer,
      makePlatformConfigStub(7),
    );
    await service.request('me', ctx);
    mailer.sent.length = 0;
    await service.cancel('me', ctx);
    expect(prisma.erasures[0]?.cancelledAt).toBeInstanceOf(Date);
    expect(audit.calls.map((c) => c.action)).toContain('account.erasure.cancelled');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.subject).toContain('cancelled');
  });

  it('is idempotent when no row exists', async () => {
    const prisma = makePrismaStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      makeAdminStub(),
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    await expect(service.cancel('me', ctx)).resolves.toBeUndefined();
  });
});

describe('AccountErasureService.cancelByToken', () => {
  it('valid token cancels the row', async () => {
    const prisma = makePrismaStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      makeAdminStub(),
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    await service.request('me', ctx);
    const token = prisma.erasures[0]!.undoToken;
    await service.cancelByToken(token);
    expect(prisma.erasures[0]?.cancelledAt).toBeInstanceOf(Date);
  });

  it('invalid token → 422', async () => {
    const prisma = makePrismaStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      makeAdminStub(),
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    await expect(service.cancelByToken('nope')).rejects.toMatchObject({
      status: 422,
      type: 'account.erasure_token_invalid',
    });
  });

  it('used token cannot cancel a second time', async () => {
    const prisma = makePrismaStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      makeAdminStub(),
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    await service.request('me', ctx);
    const token = prisma.erasures[0]!.undoToken;
    await service.cancelByToken(token);
    await expect(service.cancelByToken(token)).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('AccountErasureService.executeIfDue', () => {
  function dueRow(extra: Partial<ErasureRow> = {}): ErasureRow {
    return {
      userId: 'me',
      requestedAt: new Date('2026-05-15T12:00:00Z'),
      executeAfter: new Date('2026-05-22T12:00:00Z'),
      undoToken: 'tok',
      cancelledAt: null,
      completedAt: null,
      ...extra,
    };
  }

  it('runs admin.performErasure on due rows, stamps completedAt, sends goodbye email', async () => {
    const prisma = makePrismaStub({ erasures: [dueRow()] });
    const admin = makeAdminStub();
    const mailer = makeMailerStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      admin,
      makeAuditStub().audit,
      mailer.mailer,
      makePlatformConfigStub(7),
    );
    const res = await service.executeIfDue(new Date('2026-05-23T12:00:00Z'));
    expect(res).toEqual({ executed: 1, skipped: 0 });
    expect(admin.performErasure).toHaveBeenCalledOnce();
    expect(prisma.erasures[0]?.completedAt).toBeInstanceOf(Date);
    expect(mailer.sent.map((s) => s.subject)).toEqual(['Your account has been deleted']);
  });

  it('skips rows whose executeAfter is in the future', async () => {
    const prisma = makePrismaStub({
      erasures: [dueRow({ executeAfter: new Date('2099-01-01T00:00:00Z') })],
    });
    const admin = makeAdminStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      admin,
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    const res = await service.executeIfDue(new Date('2026-05-23T12:00:00Z'));
    expect(res).toEqual({ executed: 0, skipped: 0 });
    expect(admin.performErasure).not.toHaveBeenCalled();
  });

  it('skips rows already cancelled', async () => {
    const prisma = makePrismaStub({
      erasures: [dueRow({ cancelledAt: new Date('2026-05-20T00:00:00Z') })],
    });
    const admin = makeAdminStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      admin,
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    const res = await service.executeIfDue(new Date('2026-05-23T12:00:00Z'));
    expect(res).toEqual({ executed: 0, skipped: 0 });
    expect(admin.performErasure).not.toHaveBeenCalled();
  });

  it('skips + completes rows where the user is already erased (admin path beat us)', async () => {
    const prisma = makePrismaStub({
      users: [{ id: 'me', email: null, deletedAt: new Date('2026-05-22T12:00:00Z') }],
      erasures: [dueRow()],
    });
    const admin = makeAdminStub();
    const service = new AccountErasureService(
      prisma.stub as never,
      admin,
      makeAuditStub().audit,
      makeMailerStub().mailer,
      makePlatformConfigStub(7),
    );
    const res = await service.executeIfDue(new Date('2026-05-23T12:00:00Z'));
    expect(res).toEqual({ executed: 0, skipped: 1 });
    expect(admin.performErasure).not.toHaveBeenCalled();
    expect(prisma.erasures[0]?.completedAt).toBeInstanceOf(Date);
  });
});
