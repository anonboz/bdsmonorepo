// FAT service: all business logic + Prisma live here; the route handler is thin.
// The tenant is a renter, NOT org-scoped. Every function takes the
// SessionContext first and scopes by session.userId ONLY, cross-org — a tenant
// reaches leases through their Tenancy rows (Tenancy.userId). Money is integer
// cents.

import { db } from "@repo/db";
import { leaseInspectionWindow } from "@repo/shared";

import type { SessionContext } from "@/lib/session";

export type LeaseInspection = {
  id: string;
  type: string; // InspectionType
  completedAt: Date | null;
  notes: string | null;
  photos: { id: string; url: string }[];
};

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

  // Condition records: inspections the landlord recorded for THIS lease (see
  // leaseInspectionWindow) plus their photos, read-only for the tenant.
  const next = await db.lease.findFirst({
    where: { unitId: lease.unitId, createdAt: { gt: lease.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const inspectionRows = await db.inspection.findMany({
    where: {
      unitId: lease.unitId,
      createdAt: leaseInspectionWindow(lease.createdAt, next?.createdAt ?? null),
    },
    orderBy: { createdAt: "asc" },
  });
  const photos =
    inspectionRows.length === 0
      ? []
      : await db.document.findMany({
          where: {
            organizationId: lease.organizationId,
            type: "inspection_photo",
            entityType: "Inspection",
            entityId: { in: inspectionRows.map((i) => i.id) },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true, url: true, entityId: true },
        });
  const inspections: LeaseInspection[] = inspectionRows.map((i) => ({
    id: i.id,
    type: i.type,
    completedAt: i.completedAt,
    notes: i.notes,
    photos: photos.filter((p) => p.entityId === i.id).map((p) => ({ id: p.id, url: p.url })),
  }));

  return { ...lease, inspections };
}
