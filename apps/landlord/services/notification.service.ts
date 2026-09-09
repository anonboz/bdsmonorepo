// FAT service: the landlord app as a notification PRODUCER. Notification rows
// are per-user (userId), not org-scoped, so the multi-tenant guard lives in the
// CALLER: every entry point here takes a lease/org the caller has ALREADY
// asserted belongs to session.organizationId. Never pass an id straight from a
// request body without that check.
//
// Every function accepts either the root client or a transaction client, so a
// producer can write the notification in the same transaction as the event
// that caused it (an invoice with no notification, or vice-versa, is a bug).

import { db, type Prisma } from "@repo/db";
import { NotFoundError, type NotificationPayload } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

type DbClient = typeof db | Prisma.TransactionClient;

/** "Feb 1, 2026" — for notification bodies, which are plain English text. */
export function formatNotificationDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Write one row per distinct user. Returns the number of rows created. */
export async function notifyUsers(
  client: DbClient,
  userIds: readonly string[],
  payload: NotificationPayload,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const { count } = await client.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body ?? null,
      deepLink: payload.deepLink ?? null,
    })),
  });
  return count;
}

/** Notify everyone on a lease. Caller must have verified the lease is in-org. */
export async function notifyLeaseTenants(
  client: DbClient,
  leaseId: string,
  payload: NotificationPayload,
): Promise<number> {
  const tenancies = await client.tenancy.findMany({
    where: { leaseId },
    select: { userId: true },
  });
  return notifyUsers(
    client,
    tenancies.map((t) => t.userId),
    payload,
  );
}

/**
 * Notify every current tenant of an org — anyone on a draft or active lease.
 * Ended/terminated leases are skipped so former tenants stop hearing from the org.
 */
export async function notifyOrgTenants(
  client: DbClient,
  organizationId: string,
  payload: NotificationPayload,
): Promise<number> {
  const tenancies = await client.tenancy.findMany({
    where: { lease: { organizationId, status: { in: ["draft", "active"] } } },
    select: { userId: true },
  });
  return notifyUsers(
    client,
    tenancies.map((t) => t.userId),
    payload,
  );
}

// ── Read side: the signed-in staff member's own inbox ────────────────────────
// Notifications are per-user, so these scope by session.userId (not org) and
// assert ownership after findUnique — someone else's row is "not found".

export type NotificationRow = {
  id: string;
  type: string; // NotificationType, stored as a plain string
  title: string;
  body: string | null;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
};

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
