// FAT service: all business logic + Prisma live here; the route handler is thin.
// Every function takes the SessionContext first and scopes by
// session.organizationId ONLY. Money is integer cents.

import { db } from "@repo/db";
import type { ApplicationStatus } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

// ── List ─────────────────────────────────────────────────────────────────────

const listApplicationsSchema = z.object({
  status: z.enum(["submitted", "screening", "approved", "rejected", "withdrawn"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listApplications(session: SessionContext, rawQuery: unknown) {
  const { status, take, skip } = listApplicationsSchema.parse(rawQuery);
  const where = {
    organizationId: session.organizationId, // tenant scope — never optional
    ...(status ? { status: status as ApplicationStatus } : {}),
  };

  const [rows, total] = await Promise.all([
    db.application.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: {
        listing: {
          select: {
            title: true,
            unit: { select: { label: true, property: { select: { name: true } } } },
          },
        },
        applicant: { select: { name: true, email: true } },
        screening: { select: { status: true } },
      },
    }),
    db.application.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Read one (ownership-checked) ─────────────────────────────────────────────

export async function getApplication(session: SessionContext, id: string) {
  const application = await db.application.findUnique({
    where: { id },
    include: {
      applicant: { select: { name: true, email: true } },
      screening: true,
      listing: {
        select: {
          title: true,
          unit: { select: { label: true, property: { select: { name: true } } } },
        },
      },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!application || application.organizationId !== session.organizationId) {
    throw new NotFoundError("Listing not found");
  }
  return application;
}
