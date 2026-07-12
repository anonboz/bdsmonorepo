// FAT service: all business logic + Prisma live here; the route handler is thin.
// The tenant is a renter, NOT org-scoped. Every function takes the
// SessionContext first and scopes by session.userId ONLY, cross-org — a tenant
// reaches leases through their Tenancy rows (Tenancy.userId). Money is integer
// cents.

import { db } from "@repo/db";

import type { SessionContext } from "@/lib/session";

// ── List (this tenant's leases, cross-org) ───────────────────────────────────

export async function listMyLeases(session: SessionContext) {
  const rows = await db.lease.findMany({
    where: { tenancies: { some: { userId: session.userId } } },
    orderBy: { createdAt: "desc" },
    include: {
      unit: {
        select: {
          label: true,
          property: { select: { name: true, city: true } },
        },
      },
    },
  });

  return { rows, total: rows.length };
}

// ── Read one (tenancy-checked) ───────────────────────────────────────────────

export async function getMyLease(session: SessionContext, leaseId: string) {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    include: {
      unit: {
        select: {
          label: true,
          property: { select: { name: true, city: true } },
        },
      },
      invoices: { orderBy: { periodStart: "desc" }, take: 12 },
      tenancies: { select: { userId: true, isPrimary: true } },
    },
  });

  // Assert the caller is a tenant on this lease AFTER findUnique — the
  // load-bearing scoping check. A lease they're not on is reported as not found.
  if (!lease || !lease.tenancies.some((t) => t.userId === session.userId)) {
    throw new Error("LEASE_NOT_FOUND");
  }
  return lease;
}
