// FAT service: announcements shown to a tenant. The tenant is NOT org-scoped in
// session, so we derive their orgs from the leases they're a tenant on
// (Tenancy → Lease.organizationId) and return platform-wide "system"
// announcements (organizationId = null) PLUS "landlord" announcements for those
// orgs. Only published (publishedAt in the past) and un-expired rows are shown.

import { db } from "@repo/db";

import type { SessionContext } from "@/lib/session";

export type AnnouncementRow = {
  id: string;
  kind: "system" | "landlord";
  title: string;
  body: string;
  source: string; // org name for landlord announcements; "" for system
  publishedAt: Date;
};

export async function listMyAnnouncements(session: SessionContext): Promise<AnnouncementRow[]> {
  // The tenant's orgs: distinct organizationId across leases they're a tenant on.
  const leases = await db.lease.findMany({
    where: { tenancies: { some: { userId: session.userId } } },
    select: { organizationId: true },
  });
  const orgIds = [...new Set(leases.map((l) => l.organizationId))];

  const now = new Date();
  const rows = await db.announcement.findMany({
    where: {
      publishedAt: { lte: now }, // excludes drafts (null) and future-dated rows
      AND: [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        // system (null org) OR a landlord announcement for one of the tenant's orgs
        { OR: [{ organizationId: null }, { organizationId: { in: orgIds } }] },
      ],
    },
    orderBy: { publishedAt: "desc" },
    include: { organization: { select: { name: true } } },
  });

  return rows.map((a) => ({
    id: a.id,
    kind: a.organizationId ? "landlord" : "system",
    title: a.title,
    body: a.body,
    source: a.organization?.name ?? "",
    // publishedAt is guaranteed non-null by the `lte: now` filter above.
    publishedAt: a.publishedAt!,
  }));
}
