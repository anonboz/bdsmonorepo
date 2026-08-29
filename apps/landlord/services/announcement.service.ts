// FAT service: per-org "landlord" announcements shown to that org's tenants on
// their home page. Scopes by session.organizationId ONLY (never body/params).
// Platform-wide "system" announcements are authored in the admin app instead.

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

export type OrgAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  published: boolean;
  publishedAt: string | null; // ISO
  expiresAt: string | null; // ISO
  createdAt: string; // ISO
};

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
