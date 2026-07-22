// FAT service: business logic + Prisma for per-org utility rates. Scopes by
// session.organizationId ONLY. The owner sets a price per consumption unit for
// each metered utility, constrained to the admin's platform-wide min/max bound.
// Money is integer cents per unit.

import { db } from "@repo/db";
import { ConflictError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

// Metered utilities the owner can price. `rent`/`other` are not metered here.
const METERED = ["water", "electricity"] as const;
type Metered = (typeof METERED)[number];

export type UtilityRateRow = {
  kind: Metered;
  unit: string; // "m³" | "kWh"
  pricePerUnit: number | null; // this org's rate (cents/unit), null if unset
  min: number; // admin bound, cents/unit
  max: number; // admin bound, cents/unit
};

// ── List (this org's rates + the admin bounds that gate them) ────────────────

export async function listUtilityRates(session: SessionContext): Promise<UtilityRateRow[]> {
  const [bounds, rates] = await Promise.all([
    db.utilityRateBound.findMany(),
    db.orgUtilityRate.findMany({ where: { organizationId: session.organizationId } }),
  ]);

  // Drive the list off the bounds (the admin-defined catalog of priceable
  // utilities), in a stable order; fold in this org's rate where set.
  return METERED.flatMap((kind) => {
    const bound = bounds.find((b) => b.kind === kind);
    if (!bound) return [];
    const rate = rates.find((r) => r.kind === kind);
    return [
      {
        kind,
        unit: bound.unit,
        pricePerUnit: rate?.pricePerUnit ?? null,
        min: bound.minPricePerUnit,
        max: bound.maxPricePerUnit,
      },
    ];
  });
}

// ── Upsert (owner sets a rate, gated by the admin bound) ─────────────────────

const upsertSchema = z.object({
  kind: z.enum(METERED),
  pricePerUnit: z.coerce.number().int().min(0), // cents/unit
});

export async function upsertUtilityRate(session: SessionContext, raw: unknown) {
  const input = upsertSchema.parse(raw);

  const bound = await db.utilityRateBound.findUnique({ where: { kind: input.kind } });
  if (!bound) throw new ConflictError("No price bound is configured for this utility yet");

  // Enforce the admin gate — surfaces as a 400 VALIDATION_ERROR via the mapper.
  z.number()
    .int()
    .min(
      bound.minPricePerUnit,
      `Price must be at least ${bound.minPricePerUnit} (cents/${bound.unit})`,
    )
    .max(
      bound.maxPricePerUnit,
      `Price must be at most ${bound.maxPricePerUnit} (cents/${bound.unit})`,
    )
    .parse(input.pricePerUnit);

  return db.orgUtilityRate.upsert({
    where: {
      organizationId_kind: { organizationId: session.organizationId, kind: input.kind },
    },
    create: {
      organizationId: session.organizationId,
      kind: input.kind,
      unit: bound.unit,
      pricePerUnit: input.pricePerUnit,
    },
    update: { unit: bound.unit, pricePerUnit: input.pricePerUnit },
  });
}
