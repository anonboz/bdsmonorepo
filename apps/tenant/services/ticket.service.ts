// FAT service: business logic + Prisma for the tenant's maintenance requests
// ("tickets"). The tenant is a renter, NOT org-scoped — scope by session.userId
// ONLY: a tenant sees the requests THEY reported (reportedByUserId), cross-org.

import { db } from "@repo/db";
import { ConflictError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { notifyUsers } from "./notification.service";

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

// ── Create (raise a request on one of the tenant's own leases) ───────────────

const createSchema = z.object({
  leaseId: z.string().min(1),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "medium", "high", "emergency"]).default("medium"),
});

export async function createMyTicket(session: SessionContext, raw: unknown) {
  const input = createSchema.parse(raw);

  // The unit and org come from the tenant's OWN lease — never from the body.
  // A lease they're not on is reported as "not found".
  const lease = await db.lease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      unitId: true,
      organizationId: true,
      status: true,
      tenancies: { select: { userId: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });
  if (!lease || !lease.tenancies.some((t) => t.userId === session.userId)) {
    throw new NotFoundError("Lease not found");
  }
  if (lease.status !== "active" && lease.status !== "draft") {
    throw new ConflictError("Requests can only be raised on a current lease");
  }

  // Request + staff notifications in one transaction: nobody is pinged about
  // a request that failed to save.
  return db.$transaction(async (tx) => {
    const request = await tx.maintenanceRequest.create({
      data: {
        organizationId: lease.organizationId,
        unitId: lease.unitId,
        reportedByUserId: session.userId,
        title: input.title,
        description: input.description || null,
        priority: input.priority,
      },
    });

    // The org's staff who triage requests (not vendors, not platform admins).
    const staff = await tx.orgMembership.findMany({
      where: { organizationId: lease.organizationId, role: { in: ["owner", "landlord", "agent"] } },
      select: { userId: true },
    });
    await notifyUsers(
      tx,
      staff.map((m) => m.userId),
      {
        type: "maintenance_request_created",
        title: `New maintenance request: ${input.title}`,
        body: `${lease.unit.property.name} · ${lease.unit.label} — ${input.priority} priority, reported by ${session.name || "a tenant"}`,
        deepLink: "/maintenance",
      },
    );

    return request;
  });
}
