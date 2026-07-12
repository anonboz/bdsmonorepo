// FAT service: all business logic + Prisma live here; the route handler is thin.
// Every function takes the SessionContext first and scopes by the work order's
// request.organizationId (via session.organizationId) ONLY. Money is integer cents.

import { db } from "@repo/db";
import type { WorkOrderStatus } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

// ── List ─────────────────────────────────────────────────────────────────────

const listWorkOrdersSchema = z.object({
  status: z.enum(["pending", "scheduled", "in_progress", "completed", "cancelled"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listWorkOrders(session: SessionContext, rawQuery: unknown) {
  const { status, take, skip } = listWorkOrdersSchema.parse(rawQuery);
  const where = {
    // Org scope — never optional. Work orders are scoped via their request's org.
    request: { organizationId: session.organizationId },
    ...(status ? { status: status as WorkOrderStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    db.workOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        request: {
          select: {
            title: true,
            priority: true,
            unit: { select: { label: true, property: { select: { name: true } } } },
          },
        },
      },
    }),
    db.workOrder.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Read one (ownership-checked) ─────────────────────────────────────────────

export async function getWorkOrder(session: SessionContext, id: string) {
  const workOrder = await db.workOrder.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          organizationId: true,
          title: true,
          priority: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!workOrder || workOrder.request.organizationId !== session.organizationId) {
    throw new NotFoundError("Work order not found");
  }
  return workOrder;
}
