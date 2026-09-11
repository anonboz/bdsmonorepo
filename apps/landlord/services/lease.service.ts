// FAT service: all business logic + Prisma live here; the route handler is thin.
// Every function takes the SessionContext first and scopes by
// session.organizationId ONLY. Money is integer cents.

import { db } from "@repo/db";
import type { LeaseStatus } from "@repo/db";
import { ConflictError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";
import { formatNotificationDate, notifyLeaseTenants, notifyUsers } from "./notification.service";

// ── Create ───────────────────────────────────────────────────────────────────

const createLeaseSchema = z.object({
  unitId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  rentAmount: z.number().int().min(0), // cents
  depositAmount: z.number().int().min(0).default(0),
  rentDueDay: z.number().int().min(1).max(28).default(1),
  tenantUserIds: z.array(z.string().min(1)).min(1), // first = primary
});

export async function createLease(session: SessionContext, raw: unknown) {
  const input = createLeaseSchema.parse(raw);
  if (new Date(input.endDate) <= new Date(input.startDate)) {
    throw new Error("END_BEFORE_START");
  }

  // Multi-tenant guard: the unit must belong to the caller's org. A cross-org
  // unit is reported as "not found" so we don't leak its existence.
  const unit = await db.unit.findUnique({
    where: { id: input.unitId },
    select: {
      id: true,
      status: true,
      label: true,
      property: { select: { organizationId: true, name: true } },
    },
  });
  if (!unit) throw new Error("UNIT_NOT_FOUND");
  if (unit.property.organizationId !== session.organizationId) {
    throw new NotFoundError("Unit not found");
  }
  if (unit.status === "offline") throw new Error("UNIT_NOT_AVAILABLE");

  // No overlapping draft/active lease on the same unit.
  const overlap = await db.lease.findFirst({
    where: {
      unitId: input.unitId,
      status: { in: ["draft", "active"] },
      startDate: { lte: new Date(input.endDate) },
      endDate: { gte: new Date(input.startDate) },
    },
    select: { id: true },
  });
  if (overlap) throw new Error("OVERLAPPING_LEASE");

  // Lease + tenant notifications in one transaction: nobody is told about a
  // lease that failed to save. The unit was asserted in-org above, and the
  // tenant ids come straight from the rows we just created.
  return db.$transaction(async (tx) => {
    const lease = await tx.lease.create({
      data: {
        organizationId: session.organizationId,
        unitId: input.unitId,
        status: "draft",
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        rentAmount: input.rentAmount,
        depositAmount: input.depositAmount,
        rentDueDay: input.rentDueDay,
        tenancies: {
          create: input.tenantUserIds.map((userId, i) => ({ userId, isPrimary: i === 0 })),
        },
      },
      include: { tenancies: { select: { userId: true, isPrimary: true } } },
    });

    await notifyUsers(
      tx,
      lease.tenancies.map((t) => t.userId),
      {
        type: "lease_created",
        title: `New lease: ${unit.property.name} · ${unit.label}`,
        body: `${formatNotificationDate(lease.startDate)} – ${formatNotificationDate(lease.endDate)}. Review the terms in My leases.`,
        deepLink: "/my-leases",
      },
    );

    return lease;
  });
}

// ── List ─────────────────────────────────────────────────────────────────────

const listLeasesSchema = z.object({
  status: z.enum(["draft", "active", "ended", "terminated", "renewed"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listLeases(session: SessionContext, rawQuery: unknown) {
  const { status, take, skip } = listLeasesSchema.parse(rawQuery);
  const where = {
    organizationId: session.organizationId, // tenant scope — never optional
    ...(status ? { status: status as LeaseStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    db.lease.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        unit: { select: { label: true, property: { select: { name: true } } } },
        tenancies: { select: { userId: true, isPrimary: true } },
      },
    }),
    db.lease.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Read one (ownership-checked) ─────────────────────────────────────────────

export async function getLease(session: SessionContext, leaseId: string) {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    include: {
      unit: { select: { label: true, property: { select: { name: true, city: true } } } },
      tenancies: {
        orderBy: { isPrimary: "desc" },
        select: {
          userId: true,
          isPrimary: true,
          user: { select: { name: true, email: true } },
        },
      },
      invoices: { orderBy: { periodStart: "desc" }, take: 12 },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!lease || lease.organizationId !== session.organizationId) {
    throw new Error("LEASE_NOT_FOUND");
  }
  return lease;
}

// ── Status transitions ───────────────────────────────────────────────────────
// draft → active (signing), active → ended | terminated | renewed. Anything
// else is a conflict. Tenants are told in the same transaction as the write.

const LEASE_TRANSITIONS: Record<LeaseStatus, readonly LeaseStatus[]> = {
  draft: ["active"],
  active: ["ended", "terminated", "renewed"],
  ended: [],
  terminated: [],
  renewed: [],
};

const setLeaseStatusSchema = z.object({
  status: z.enum(["active", "ended", "terminated", "renewed"]),
});

const LEASE_STATUS_TITLES: Record<z.infer<typeof setLeaseStatusSchema>["status"], string> = {
  active: "Your lease is now active",
  ended: "Your lease has ended",
  terminated: "Your lease has been terminated",
  renewed: "Your lease has been renewed",
};

export async function setLeaseStatus(session: SessionContext, leaseId: string, raw: unknown) {
  const { status } = setLeaseStatusSchema.parse(raw);

  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    include: { unit: { select: { label: true, property: { select: { name: true } } } } },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!lease || lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }
  if (lease.status === status) return lease;
  if (!LEASE_TRANSITIONS[lease.status].includes(status)) {
    throw new ConflictError(`A ${lease.status} lease can't be marked ${status}`);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.lease.update({
      where: { id: lease.id },
      data: {
        status,
        // Activation is the signing event; keep an existing signedAt untouched.
        ...(status === "active" && !lease.signedAt ? { signedAt: new Date() } : {}),
      },
    });
    await notifyLeaseTenants(tx, lease.id, {
      type: "lease_status_changed",
      title: LEASE_STATUS_TITLES[status],
      body: `${lease.unit.property.name} · ${lease.unit.label} — ${formatNotificationDate(lease.startDate)} – ${formatNotificationDate(lease.endDate)}`,
      deepLink: `/my-leases/${lease.id}`,
    });
    return updated;
  });
}
