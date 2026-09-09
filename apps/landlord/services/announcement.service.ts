// FAT service: per-org "landlord" announcements shown to that org's tenants on
// their home page. Scopes by session.organizationId ONLY (never body/params).
// Platform-wide "system" announcements are authored in the admin app instead.

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { notifyOrgTenants } from "./notification.service";

export type OrgAnnouncementRow = {
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

/** Fan a just-published announcement out to the org's current tenants. */
function announcePublished(organizationId: string, a: { title: string; body: string }) {
  return notifyOrgTenants(db, organizationId, {
    type: "announcement_published",
    title: a.title,
    body: excerpt(a.body),
    deepLink: "/",
  });
}

function toRow(a: {
  id: string;
  title: string;
  body: string;
  publishedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}): OrgAnnouncementRow {
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

// ── List (this org's announcements, drafts included) ─────────────────────────

export async function listOrgAnnouncements(session: SessionContext): Promise<OrgAnnouncementRow[]> {
  const rows = await db.announcement.findMany({
    where: { organizationId: session.organizationId },
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

export async function createOrgAnnouncement(session: SessionContext, raw: unknown) {
  const input = createSchema.parse(raw);
  const created = await db.announcement.create({
    data: {
      organizationId: session.organizationId, // from session ONLY
      title: input.title,
      body: input.body,
      publishedAt: input.publishNow ? new Date() : null,
      expiresAt: input.expiresAt ?? null,
    },
  });
  if (created.publishedAt) await announcePublished(session.organizationId, created);
  return toRow(created);
}

// ── Toggle published ─────────────────────────────────────────────────────────

const publishSchema = z.object({ published: z.coerce.boolean() });

export async function setOrgAnnouncementPublished(
  session: SessionContext,
  id: string,
  raw: unknown,
) {
  const { published } = publishSchema.parse(raw);

  // Assert org ownership AFTER findUnique — a row from another org is "not found".
  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.organizationId) {
    throw new NotFoundError("Announcement not found");
  }

  const updated = await db.announcement.update({
    where: { id },
    data: { publishedAt: published ? (existing.publishedAt ?? new Date()) : null },
  });
  // Only the draft → published transition notifies; re-publishing an already
  // published row (a no-op) or unpublishing never pings tenants.
  if (published && existing.publishedAt == null) {
    await announcePublished(session.organizationId, updated);
  }
  return toRow(updated);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteOrgAnnouncement(session: SessionContext, id: string) {
  const existing = await db.announcement.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.organizationId) {
    throw new NotFoundError("Announcement not found");
  }
  await db.announcement.delete({ where: { id } });
  return { id };
}
