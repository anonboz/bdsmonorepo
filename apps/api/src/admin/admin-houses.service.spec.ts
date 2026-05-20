import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminHousesService } from './admin-houses.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';

function makePrismaStub(opts: {
  houseId: string;
  ownerId?: string;
  moderationStatus?: 'OK' | 'FLAGGED' | 'REJECTED';
  isPublished?: boolean;
}) {
  const houses: Record<string, unknown>[] = [
    {
      id: opts.houseId,
      ownerId: opts.ownerId ?? 'owner_1',
      name: 'Test House',
      description: null,
      addressLine1: '1 Test St',
      addressLine2: null,
      city: 'Hanoi',
      state: null,
      postalCode: null,
      country: 'VN',
      lat: null,
      lng: null,
      isPublished: opts.isPublished ?? true,
      moderationStatus: opts.moderationStatus ?? 'OK',
      moderationReason: null,
      moderationDecidedAt: null,
      moderationDecidedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      _count: { units: 0 },
    },
  ];
  const auditRows: Record<string, unknown>[] = [];

  const stub: Record<string, unknown> = {};
  stub.house = {
    findUnique: vi.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(houses.find((h) => h.id === where.id) ?? null),
    ),
    findMany: vi.fn(() => Promise.resolve(houses)),
    update: vi.fn(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const h = houses.find((x) => x.id === where.id);
      if (!h) throw new Error('not found');
      Object.assign(h, data, { updatedAt: new Date() });
      return Promise.resolve(h);
    }),
  };
  stub.auditLog = {
    create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
      auditRows.push({ id: `log_${auditRows.length + 1}`, ...data });
      return Promise.resolve(auditRows.at(-1));
    }),
  };
  stub.$transaction = vi.fn(<T>(fn: (tx: unknown) => Promise<T>) => fn(stub));

  return { stub, houses, auditRows };
}

const ctx = { actorId: 'admin_1', ip: '127.0.0.1', userAgent: 'curl/test' };

describe('AdminHousesService', () => {
  const houseId = 'house_1';
  let service: AdminHousesService;
  let store: ReturnType<typeof makePrismaStub>;

  function boot(opts: Parameters<typeof makePrismaStub>[0]) {
    store = makePrismaStub(opts);
    service = new AdminHousesService(store.stub as never, new AuditLogger(store.stub as never));
  }

  beforeEach(() => {
    boot({ houseId });
  });

  it('flag flips status and writes the audit entry atomically', async () => {
    await service.flag(houseId, { reason: 'missing photos' }, ctx);
    expect(store.houses[0]?.moderationStatus).toBe('FLAGGED');
    expect(store.houses[0]?.moderationReason).toBe('missing photos');
    expect(store.houses[0]?.moderationDecidedBy).toBe(ctx.actorId);
    expect(store.auditRows).toHaveLength(1);
    expect(store.auditRows[0]).toMatchObject({
      action: 'house.flag',
      target: `House:${houseId}`,
      actorId: ctx.actorId,
    });
    const meta = store.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.previousStatus).toBe('OK');
    expect(meta.reason).toBe('missing photos');
  });

  it('flagging an already-FLAGGED house → 409', async () => {
    boot({ houseId, moderationStatus: 'FLAGGED' });
    await expect(service.flag(houseId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(ProblemError);
  });

  it('clear resets to OK and nulls the reason', async () => {
    boot({ houseId, moderationStatus: 'FLAGGED' });
    // simulate that flag set a prior reason
    store.houses[0]!.moderationReason = 'missing photos';
    await service.clear(houseId, { reason: 'owner uploaded photos' }, ctx);
    expect(store.houses[0]?.moderationStatus).toBe('OK');
    expect(store.houses[0]?.moderationReason).toBeNull();
    expect(store.auditRows[0]?.action).toBe('house.clear');
    const meta = store.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.previousStatus).toBe('FLAGGED');
    expect(meta.previousReason).toBe('missing photos');
  });

  it('clearing an OK house → 409', async () => {
    await expect(service.clear(houseId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(ProblemError);
  });

  it('reject flips status, auto-unpublishes, and records wasPublished=true', async () => {
    await service.reject(houseId, { reason: 'fake photos' }, ctx);
    expect(store.houses[0]?.moderationStatus).toBe('REJECTED');
    expect(store.houses[0]?.isPublished).toBe(false);
    expect(store.auditRows[0]?.action).toBe('house.reject');
    const meta = store.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.wasPublished).toBe(true);
  });

  it('reject on an unpublished house records wasPublished=false but still moves to REJECTED', async () => {
    boot({ houseId, isPublished: false });
    await service.reject(houseId, { reason: 'duplicate listing' }, ctx);
    expect(store.houses[0]?.moderationStatus).toBe('REJECTED');
    expect(store.houses[0]?.isPublished).toBe(false);
    const meta = store.auditRows[0]?.meta as Record<string, unknown>;
    expect(meta.wasPublished).toBe(false);
  });

  it('rejecting an already-REJECTED house → 409', async () => {
    boot({ houseId, moderationStatus: 'REJECTED' });
    await expect(service.reject(houseId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(
      ProblemError,
    );
  });

  it('missing house → 404', async () => {
    await expect(service.flag('nope', { reason: 'x' }, ctx)).rejects.toBeInstanceOf(ProblemError);
  });

  it('soft-deleted house → 404', async () => {
    store.houses[0]!.deletedAt = new Date();
    await expect(service.flag(houseId, { reason: 'x' }, ctx)).rejects.toBeInstanceOf(ProblemError);
  });
});
