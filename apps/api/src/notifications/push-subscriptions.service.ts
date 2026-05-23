import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ErrorCodes,
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  type CreatePushSubscriptionInput,
  type ListPushSubscriptionsResponse,
  type PushSubscription,
} from '@repo/shared';

import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/**
 * Phase 10.5 — owner of the `PushSubscription` table.
 *
 * CRUD operations are scoped to the authenticated user; the worker
 * pulls every active row for a recipient via {@link listForRecipient}
 * + deletes rows the push service rejects via {@link deleteByEndpoint}.
 *
 * `vapidEnabled` is the boot-time gate: when VAPID keys aren't
 * configured, POST returns 503 so the client doesn't store key
 * material we couldn't honor anyway.
 */
@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  get vapidEnabled(): boolean {
    // Read process.env at call-time (not the cached `env` module) so
    // tests can flip the keys on/off between cases. The env loader
    // still validates these at boot for production.
    return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  }

  async list(userId: string): Promise<ListPushSubscriptionsResponse> {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endpoint: true, userAgent: true, createdAt: true },
    });
    return {
      subscriptions: rows.map((r) => ({
        id: r.id,
        endpoint: r.endpoint,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Used by the send worker. Returns the full key material so the
   * worker can pass through to `web-push.sendNotification` without
   * re-querying. Not exposed via the HTTP surface.
   */
  async listForRecipient(
    userId: string,
  ): Promise<{ id: string; endpoint: string; p256dh: string; auth: string }[]> {
    return this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  }

  /**
   * Upsert by `(userId, endpoint)`. Re-subscribing the same browser
   * produces the same `endpoint`; the key material may rotate.
   */
  async create(userId: string, input: CreatePushSubscriptionInput): Promise<PushSubscription> {
    if (!this.vapidEnabled) {
      throw new ProblemError({
        status: 503,
        type: ErrorCodes.PUSH_PROVIDER_DISABLED,
        title: 'Web push provider not configured',
        detail: 'The API has no VAPID keypair; push subscriptions cannot be accepted.',
      });
    }

    const existing = await this.prisma.pushSubscription.count({ where: { userId } });
    const existsSameEndpoint = await this.prisma.pushSubscription.findUnique({
      where: { userId_endpoint: { userId, endpoint: input.endpoint } },
      select: { id: true },
    });
    if (!existsSameEndpoint && existing >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.PUSH_LIMIT_REACHED,
        title: 'Push subscription limit reached',
        detail: `Each user can carry at most ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} subscriptions. Delete one before adding another.`,
      });
    }

    const row = await this.prisma.pushSubscription.upsert({
      where: { userId_endpoint: { userId, endpoint: input.endpoint } },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
      },
      update: {
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent ?? null,
        // Re-subscription clears any prior terminal-failure stamp.
        failedAt: null,
      },
    });
    return {
      id: row.id,
      endpoint: row.endpoint,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Caller-scoped delete by id. Cross-user ids return 404 (existence-
   * hiding) — same convention as the rest of the API.
   */
  async deleteByIdForUser(userId: string, id: string): Promise<void> {
    const row = await this.prisma.pushSubscription.findUnique({ where: { id } });
    if (row?.userId !== userId) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.PUSH_SUBSCRIPTION_NOT_FOUND,
        title: 'Push subscription not found',
      });
    }
    await this.prisma.pushSubscription.delete({ where: { id } });
  }

  /**
   * Worker-side cleanup helper. Called when `web-push` returns 404 /
   * 410 — the row is stale and the client will need to resubscribe.
   * Idempotent (deleteMany returns count:0 when nothing matched).
   */
  async deleteByEndpoint(endpoint: string): Promise<void> {
    const result = await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
    if (result.count > 0) {
      this.logger.log(`pruned ${result.count} stale push subscription(s) for endpoint`);
    }
  }
}
