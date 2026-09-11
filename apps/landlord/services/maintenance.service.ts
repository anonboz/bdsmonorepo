// FAT service: the org's maintenance requests (raised by tenants from the
// tenant app). Scopes by session.organizationId ONLY. Work-order creation is a
// later slice; status changes here notify the tenant who raised the request.

import { db } from "@repo/db";
import type { MaintenanceStatus } from "@repo/db";
import { ConflictError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { notifyUsers } from "./notification.service";

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

// ── Status transitions ───────────────────────────────────────────────────────
// open → triaged → assigned → in_progress → completed, with cancel allowed from
// any non-terminal state. Completed and cancelled are terminal.

const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  open: ["triaged", "assigned", "in_progress", "cancelled"],
  triaged: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const setStatusSchema = z.object({
  status: z.enum(["triaged", "assigned", "in_progress", "completed", "cancelled"]),
});

const STATUS_TITLES: Record<z.infer<typeof setStatusSchema>["status"], string> = {
  triaged: "Your request has been reviewed",
  assigned: "Your request has been assigned",
  in_progress: "Work on your request has started",
  completed: "Your request has been completed",
  cancelled: "Your request has been cancelled",
};

export async function setMaintenanceRequestStatus(
  session: SessionContext,
  requestId: string,
  raw: unknown,
) {
  const { status } = setStatusSchema.parse(raw);

  const request = await db.maintenanceRequest.findUnique({
    where: { id: requestId },
    include: { unit: { select: { label: true, property: { select: { name: true } } } } },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!request || request.organizationId !== session.organizationId) {
    throw new NotFoundError("Maintenance request not found");
  }
  if (request.status === status) return request;
  if (!MAINTENANCE_TRANSITIONS[request.status].includes(status)) {
    throw new ConflictError(
      `A ${request.status.replace("_", " ")} request can't be marked ${status.replace("_", " ")}`,
    );
  }

  // Status + tenant notification in one transaction: nobody is told about a
  // change that failed to save. The reporter id comes from the row we own.
  return db.$transaction(async (tx) => {
    const updated = await tx.maintenanceRequest.update({
      where: { id: request.id },
      data: { status },
    });
    await notifyUsers(tx, [request.reportedByUserId], {
      type: "maintenance_request_updated",
      title: `${STATUS_TITLES[status]}: ${request.title}`,
      body: `${request.unit.property.name} · ${request.unit.label}`,
      deepLink: "/my-tickets",
    });
    return updated;
  });
}
