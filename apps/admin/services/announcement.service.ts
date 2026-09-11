// FAT service for the GLOBAL admin console: platform-wide "system" announcements
// (organizationId = null) shown to every tenant on their home page. NOT
// org-scoped — these are authored by the platform admin and apply to all orgs.
// Landlord-authored, org-scoped announcements live in the landlord app instead.

import { db } from "@repo/db";
import { ForbiddenError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { notifyAllTenants } from "./notification.service";

function assertAdmin(session: SessionContext): void {
  if (session.role !== "admin") throw new ForbiddenError("Admin access required");
}

export type SystemAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  publishedAt: string | null; // ISO
  expiresAt: string | null; // ISO
  createdAt: string; // ISO
};

/** Notification bodies are one-liners; announcements can be 5000 chars. */
function excerpt(body: string, max = 160): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Fan a just-published system announcement out to every current tenant. */
function announcePublished(a: { title: string; body: string }) {
  return notifyAllTenants(db, {
    type: "announcement_published",
    title: a.title,
    body: excerpt(a.body),
    deepLink: "/announcements",
  });
}

function toRow(a: {
  id: string;
  title: string;
  body: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): SystemAnnouncementRow {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    published: a.publishedAt != null,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    expiresAt: a.expiresAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

// ── List (all system announcements, drafts included) ─────────────────────────

export async function listSystemAnnouncements(
  session: SessionContext,
): Promise<SystemAnnouncementRow[]> {
  assertAdmin(session);
  const rows = await db.announcement.findMany({
    where: { organizationId: null },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toRow);
}

// ── Create ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  publishNow: z.coerce.boolean().default(false),
  expiresAt: z.coerce.date().nullish(),
});

export async function createSystemAnnouncement(session: SessionContext, raw: unknown) {
  assertAdmin(session);
  const input = createSchema.parse(raw);
  const created = await db.announcement.create({
    data: {
      organizationId: null, // system-wide
      title: input.title,
      body: input.body,
      publishedAt: input.publishNow ? new Date() : null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  if (created.publishedAt) await announcePublished(created);
  return toRow(created);
}

// ── Toggle published ─────────────────────────────────────────────────────────

const publishSchema = z.object({ published: z.coerce.boolean() });

export async function setSystemAnnouncementPublished(
  session: SessionContext,
  id: string,
  raw: unknown,
) {
  assertAdmin(session);
  const { published } = publishSchema.parse(raw);

  // Assert this is a system announcement (organizationId null) before writing.
  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== null)
    throw new NotFoundError("Announcement not found");

  const updated = await db.announcement.update({
    where: { id },
    data: { publishedAt: published ? (existing.publishedAt ?? new Date()) : null },
  });
  // Only the draft → published transition notifies; re-publishing an already
  // published row (a no-op) or unpublishing never pings tenants.
  if (published && existing.publishedAt == null) await announcePublished(updated);
  return toRow(updated);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteSystemAnnouncement(session: SessionContext, id: string) {
  assertAdmin(session);
  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== null)
    throw new NotFoundError("Announcement not found");
  await db.announcement.delete({ where: { id } });
  return { id };
}
