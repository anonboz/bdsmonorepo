import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  ErrorCodes,
  NotificationTopic,
  type ListNotificationPreferencesResponse,
  type MarkAllReadResponse,
  type Notification,
  type NotificationPreference,
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

  // ---- Preferences (Phase 9.4) ------------------------------------

  /**
   * Returns the full topic taxonomy with the caller's current mute
   * state. Topics without an explicit row default to `muted: false`.
   */
  async listPreferences(userId: string): Promise<ListNotificationPreferencesResponse> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { topic: true, muted: true },
    });
    const muted = new Map(rows.map((r) => [r.topic, r.muted]));
    const preferences: NotificationPreference[] = Object.values(NotificationTopic).map((topic) => ({
      topic,
      muted: muted.get(topic) ?? false,
    }));
    return { preferences };
  }

  /**
   * Upserts a preference. `muted: true` creates / sets the row;
   * `muted: false` deletes any existing row (the default behaviour is
   * the absence of a row).
   *
   * Returns the resulting `{ topic, muted }` shape so the client can
   * update its UI without re-fetching the full list.
   */
  async upsertPreference(
    userId: string,
    topic: NotificationPreference['topic'],
    muted: boolean,
  ): Promise<NotificationPreference> {
    if (muted) {
      await this.prisma.notificationPreference.upsert({
        where: { userId_topic: { userId, topic } },
        create: { userId, topic, muted: true },
        update: { muted: true },
      });
      return { topic, muted: true };
    }
    // Unmute = delete the row. `deleteMany` is idempotent (count:0
    // when nothing matched) so a noop re-unmute doesn't 404.
    await this.prisma.notificationPreference.deleteMany({ where: { userId, topic } });
    return { topic, muted: false };
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
