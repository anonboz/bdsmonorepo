// FAT service for the GLOBAL admin console: all business logic + Prisma live
// here; the route handlers are thin. Every function takes the SessionContext
// first and re-asserts the platform `admin` role (belt-and-suspenders — routes
// also call requireAdmin).
//
// CRITICAL: this is the ONE service that is NOT org-scoped. There is deliberately
// NO `where: { organizationId }` filter — admin reads across every org.

import { db } from "@repo/db";
import { ForbiddenError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

/** Private guard mirrored from lib/session.requireAdmin so the service is safe
 * even if a caller forgets to gate. */
function assertAdmin(session: SessionContext): void {
  if (session.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
}

// ── Organizations (global) ───────────────────────────────────────────────────

const listOrganizationsSchema = z.object({
  active: z.coerce.boolean().optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listOrganizations(session: SessionContext, rawQuery: unknown) {
  assertAdmin(session);
  const { active, take, skip } = listOrganizationsSchema.parse(rawQuery);

  // NO org scope — admin is global.
  const where = active === undefined ? {} : { active };

  const [rows, total] = await Promise.all([
    db.organization.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        _count: { select: { properties: true, leases: true, memberships: true } },
      },
    }),
    db.organization.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Users (global) ───────────────────────────────────────────────────────────

const listUsersSchema = z.object({
  search: z.string().trim().min(1).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listUsers(session: SessionContext, rawQuery: unknown) {
  assertAdmin(session);
  const { search, take, skip } = listUsersSchema.parse(rawQuery);

  // NO org scope — admin sees every user on the platform.
  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: { id: true, name: true, email: true, active: true, createdAt: true },
    }),
    db.user.count({ where }),
  ]);

  return { rows, total, take, skip };
}
