// FAT service: the org's maintenance requests (raised by tenants from the
// tenant app). Scopes by session.organizationId ONLY. Read-only for now —
// triage/status changes and work-order creation are a later slice.

import { db } from "@repo/db";

import type { SessionContext } from "@/lib/session";

export type OrgMaintenanceRow = {
  id: string;
  title: string;
  description: string | null;
  priority: string; // MaintenancePriority
  status: string; // MaintenanceStatus
  createdAt: Date;
  property: string;
  unitLabel: string;
  reportedBy: string;
  vendorName: string | null; // latest work order's vendor, if assigned
  scheduledAt: Date | null;
};

export async function listOrgMaintenanceRequests(
  session: SessionContext,
): Promise<{ rows: OrgMaintenanceRow[]; open: number }> {
  const requests = await db.maintenanceRequest.findMany({
    where: { organizationId: session.organizationId }, // tenant scope — never optional
    orderBy: { createdAt: "desc" },
    include: {
      unit: { select: { label: true, property: { select: { name: true } } } },
      reportedBy: { select: { name: true, email: true } },
      workOrders: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { scheduledAt: true, vendor: { select: { name: true } } },
      },
    },
  });

  const rows: OrgMaintenanceRow[] = requests.map((req) => {
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
      reportedBy: req.reportedBy.name ?? req.reportedBy.email,
      vendorName: latest?.vendor?.name ?? null,
      scheduledAt: latest?.scheduledAt ?? null,
    };
  });

  const open = rows.filter((r) => r.status !== "completed" && r.status !== "cancelled").length;
  return { rows, open };
}
