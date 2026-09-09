// FAT service: the tenant's in-app notification inbox. Notifications are
// per-user, NOT org-scoped: scope by session.userId ONLY (never body/params),
// and assert ownership after every findUnique — a row belonging to someone
// else is reported as "not found" so we don't leak its existence.

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

export type NotificationRow = {
  id: string;
  type: string; // NotificationType, but stored as a plain string
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/** Inbox cap — enough history without paginating yet. */
const MAX_ROWS = 100;

const rowSelect = {
  id: true,
  type: true,
  title: true,
  body: true,
  deepLink: true,
  readAt: true,
  createdAt: true,
} as const;

// ── Read ─────────────────────────────────────────────────────────────────────

export async function listMyNotifications(
  session: SessionContext,
): Promise<{ rows: NotificationRow[]; unreadCount: number }> {
  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
      select: rowSelect,
    }),
    getUnreadCount(session),
  ]);
  return { rows, unreadCount };
}

export async function getUnreadCount(session: SessionContext): Promise<number> {
  return db.notification.count({ where: { userId: session.userId, readAt: null } });
}

// ── Mark read ────────────────────────────────────────────────────────────────

const markReadSchema = z.object({ read: z.literal(true) });

export async function markNotificationRead(
  session: SessionContext,
  id: string,
  raw: unknown,
): Promise<{ id: string; readAt: Date }> {
  markReadSchema.parse(raw);

  const existing = await db.notification.findUnique({
    where: { id },
    select: { id: true, userId: true, readAt: true },
  });
  if (!existing || existing.userId !== session.userId) {
    throw new NotFoundError("Notification not found");
  }
  // Idempotent: keep the original read timestamp on a repeat call.
  if (existing.readAt) return { id: existing.id, readAt: existing.readAt };

  return db.notification.update({
    where: { id },
    data: { readAt: new Date() },
    select: { id: true, readAt: true },
  }) as Promise<{ id: string; readAt: Date }>;
}

export async function markAllNotificationsRead(
  session: SessionContext,
): Promise<{ updated: number }> {
  const { count } = await db.notification.updateMany({
    where: { userId: session.userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: count };
}
