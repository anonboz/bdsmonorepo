// FAT service: business logic + Prisma for the tenant's maintenance requests
// ("tickets"). The tenant is a renter, NOT org-scoped — scope by session.userId
// ONLY: a tenant sees the requests THEY reported (reportedByUserId), cross-org.

import { db } from "@repo/db";

import type { SessionContext } from "@/lib/session";

export type MyTicket = {
  id: string;
  title: string;
  description: string | null;
  priority: string; // MaintenancePriority
  status: string; // MaintenanceStatus
  createdAt: Date;
  property: string;
  unitLabel: string;
  city: string;
  vendorName: string | null; // latest work order's vendor, if assigned
  scheduledAt: Date | null; // latest work order's scheduled visit
};

// ── List (this tenant's reported requests, cross-org) ────────────────────────

export async function listMyTickets(
  session: SessionContext,
): Promise<{ rows: MyTicket[]; total: number; open: number }> {
  const requests = await db.maintenanceRequest.findMany({
    where: { reportedByUserId: session.userId },
    orderBy: { createdAt: "desc" },
    include: {
      unit: { select: { label: true, property: { select: { name: true, city: true } } } },
      // Most recent work order carries the current vendor + schedule.
      workOrders: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { scheduledAt: true, vendor: { select: { name: true } } },
      },
    },
  });

  const rows: MyTicket[] = requests.map((req) => {
    const latest = req.workOrders[0];
    return {
      id: req.id,
      title: req.title,
      description: req.description,
      priority: req.priority,
      status: req.status,
      createdAt: req.createdAt,
      property: req.unit.property.name,
      unitLabel: req.unit.label,
      city: req.unit.property.city,
      vendorName: latest?.vendor?.name ?? null,
      scheduledAt: latest?.scheduledAt ?? null,
    };
  });

  // "Open" = anything not yet completed or cancelled.
  const open = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled").length;
  return { rows, total: rows.length, open };
}
