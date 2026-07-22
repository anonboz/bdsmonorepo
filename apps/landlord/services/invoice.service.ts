// FAT service: generate a rent invoice for a lease. Rent comes from the lease;
// metered utilities are priced as consumption × the org's current OrgUtilityRate.
// Scopes by session.organizationId ONLY. Money is integer cents.

import { db } from "@repo/db";
import { ConflictError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

const generateSchema = z.object({
  leaseId: z.string().min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  dueDate: z.string().datetime(),
  waterConsumption: z.coerce.number().min(0).optional(), // m³
  electricityConsumption: z.coerce.number().min(0).optional(), // kWh
});

type LineItemInput = {
  kind: "rent" | "water" | "electricity";
  description: string;
  quantity?: number;
  unit?: string;
  amount: number;
};

export async function generateInvoice(session: SessionContext, raw: unknown) {
  const input = generateSchema.parse(raw);
  if (new Date(input.periodEnd) <= new Date(input.periodStart)) {
    throw new Error("END_BEFORE_START");
  }

  // Multi-tenant guard: the lease must belong to the caller's org. A cross-org
  // lease is reported as "not found" so we don't leak its existence.
  const lease = await db.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true, organizationId: true, rentAmount: true },
  });
  if (!lease) throw new Error("LEASE_NOT_FOUND");
  if (lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }

  // Current per-org utility rates (set by the owner within the admin bounds).
  const rates = await db.orgUtilityRate.findMany({
    where: { organizationId: session.organizationId },
  });
  const rateFor = (kind: "water" | "electricity") => rates.find((r) => r.kind === kind);

  // Rent always; each metered utility only when consumption was entered.
  const lineItems: LineItemInput[] = [
    { kind: "rent", description: "Monthly rent", amount: lease.rentAmount },
  ];

  const meter = (kind: "water" | "electricity", label: string, consumption: number | undefined) => {
    if (consumption == null || consumption <= 0) return;
    const rate = rateFor(kind);
    if (!rate) throw new ConflictError(`No ${kind} rate is set for your organization`);
    lineItems.push({
      kind,
      description: label,
      quantity: consumption,
      unit: rate.unit,
      amount: Math.round(consumption * rate.pricePerUnit),
    });
  };
  meter("water", "Water", input.waterConsumption);
  meter("electricity", "Electricity", input.electricityConsumption);

  const amount = lineItems.reduce((sum, li) => sum + li.amount, 0);

  // Duplicate (leaseId, periodStart) surfaces as Prisma P2002 → 409 in the mapper.
  return db.rentInvoice.create({
    data: {
      organizationId: session.organizationId,
      leaseId: lease.id,
      periodStart: new Date(input.periodStart),
      periodEnd: new Date(input.periodEnd),
      dueDate: new Date(input.dueDate),
      amount,
      status: "open",
      lineItems: { create: lineItems },
    },
    include: { lineItems: { orderBy: { createdAt: "asc" } } },
  });
}
