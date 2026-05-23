import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationPreferenceScope,
  NotificationTopic,
  type ListNotificationPreferencesResponse,
  type MarkAllReadResponse,
  type Notification,
  type NotificationPreference,
  type NotificationQuietHours,
  type Page,
  type UnreadCountResponse,
} from '@repo/shared';

import type { ListNotificationsQueryDto } from './dto/notifications.dto.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

type NotificationRow = Prisma.NotificationGetPayload<Record<string, never>>;

/**
 * Read-side companion to the {@link NotificationsService} dispatch path.
 * Owns the HTTP surface — every action is scoped to the authenticated
 * user's `userId`. Cross-user ids return 404 (existence-hiding); same
 * convention as bills / tickets.
 */
@Injectable()
export class NotificationsInboxService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  async listForUser(userId: string, query: ListNotificationsQueryDto): Promise<Page<Notification>> {
    const limit = query.limit;
    const where: Prisma.NotificationWhereInput = {
      userId,
      ...(query.unread === true && { readAt: null }),
    };
    const findArgs: Prisma.NotificationFindManyArgs = {
      where,
      orderBy: [{ createdAt: query.sort }, { id: query.sort }],
      take: limit + 1,
    };
    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }
    const rows = await this.prisma.notification.findMany(findArgs);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => this.toResponse(r)),
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getForUser(userId: string, id: string): Promise<Notification> {
    const row = await this.prisma.notification.findUnique({ where: { id } });
    if (row?.userId !== userId) throw this.notFound();
    return this.toResponse(row);
  }

  /**
   * Sets `readAt = now()` if the row is unread + owned by the user.
   * Idempotent: a second call on a row that's already read returns
   * the existing row without a write. Cross-user ids → 404.
   */
  async markRead(userId: string, id: string): Promise<Notification> {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (existing?.userId !== userId) throw this.notFound();
    if (existing.readAt) return this.toResponse(existing);
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
    return this.toResponse(updated);
  }

  async markAllRead(userId: string): Promise<MarkAllReadResponse> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponse> {
    const unread = await this.prisma.notification.count({ where: { userId, readAt: null } });
    return { unread };
  }

  // ---- Preferences (Phase 9.4; per-scope in 10.4) -----------------

  /**
   * Returns one entry per existing (topic, scope) row plus a default
   * `{ scope: ALL, muted: false }` placeholder for any topic the
   * caller has zero rows for. The placeholder preserves the 9.4
   * single-toggle UX (each topic in the picker has a row).
   */
  async listPreferences(userId: string): Promise<ListNotificationPreferencesResponse> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { topic: true, scope: true, muted: true },
    });
    const seen = new Set(rows.map((r) => r.topic));
    const preferences: NotificationPreference[] = rows.map((r) => ({
      topic: r.topic as NotificationPreference['topic'],
      scope: r.scope,
      muted: r.muted,
    }));
    for (const topic of Object.values(NotificationTopic)) {
      if (seen.has(topic)) continue;
      preferences.push({ topic, scope: NotificationPreferenceScope.ALL, muted: false });
    }
    return { preferences };
  }

  /**
   * Upserts a preference at the given scope. `muted: true` creates /
   * sets the row; `muted: false` deletes any existing row for that
   * (topic, scope) — the default state is the absence of a row.
   *
   * `scope` defaults to `ALL` so the existing single-toggle PUT
   * route (no scope in the body) keeps working.
   */
  async upsertPreference(
    userId: string,
    topic: NotificationPreference['topic'],
    muted: boolean,
    scope: NotificationPreference['scope'] = NotificationPreferenceScope.ALL,
  ): Promise<NotificationPreference> {
    if (muted) {
      await this.prisma.notificationPreference.upsert({
        where: { userId_topic_scope: { userId, topic, scope } },
        create: { userId, topic, scope, muted: true },
        update: { muted: true },
      });
      return { topic, scope, muted: true };
    }
    await this.prisma.notificationPreference.deleteMany({
      where: { userId, topic, scope },
    });
    return { topic, scope, muted: false };
  }

  // ---- Quiet hours (Phase 10.4) -----------------------------------

  async getQuietHours(userId: string): Promise<NotificationQuietHours | null> {
    const row = await this.prisma.notificationQuietHours.findUnique({
      where: { userId },
    });
    if (!row) return null;
    return { startUtcMinute: row.startUtcMinute, endUtcMinute: row.endUtcMinute };
  }

  async setQuietHours(
    userId: string,
    input: NotificationQuietHours,
  ): Promise<NotificationQuietHours> {
    await this.prisma.notificationQuietHours.upsert({
      where: { userId },
      create: { userId, ...input },
      update: { ...input },
    });
    return input;
  }

  async clearQuietHours(userId: string): Promise<void> {
    await this.prisma.notificationQuietHours.deleteMany({ where: { userId } });
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.NOTIFICATION_NOT_FOUND,
      title: 'Notification not found',
    });
  }

  private toResponse(row: NotificationRow): Notification {
    return {
      id: row.id,
      userId: row.userId,
      channel: row.channel,
      topic: row.topic as Notification['topic'],
      title: row.title,
      body: row.body,
      data: row.data,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
