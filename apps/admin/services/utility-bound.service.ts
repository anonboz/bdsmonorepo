// FAT service for the GLOBAL admin console: platform-wide min/max bounds on
// metered-utility unit prices. NOT org-scoped — these bounds apply to every org.
// Owners then set a per-org rate within [min, max]. Money is integer cents/unit.

import { db } from "@repo/db";
import { ForbiddenError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

function assertAdmin(session: SessionContext): void {
  if (session.role !== "admin") throw new ForbiddenError("Admin access required");
}

const METERED = ["water", "electricity"] as const;
type Metered = (typeof METERED)[number];

const DEFAULT_UNIT: Record<Metered, string> = { water: "m³", electricity: "kWh" };

export type UtilityBoundRow = {
  kind: Metered;
  unit: string;
  min: number | null; // cents/unit, null if unset
  max: number | null;
};

// ── List (every metered utility, whether a bound is set yet or not) ──────────

export async function listUtilityBounds(session: SessionContext): Promise<UtilityBoundRow[]> {
  assertAdmin(session);
  const bounds = await db.utilityRateBound.findMany();
  return METERED.map((kind) => {
    const b = bounds.find((x) => x.kind === kind);
    return {
      kind,
      unit: b?.unit ?? DEFAULT_UNIT[kind],
      min: b?.minPricePerUnit ?? null,
      max: b?.maxPricePerUnit ?? null,
    };
  });
}

// ── Upsert (admin sets the gate) ─────────────────────────────────────────────

const upsertSchema = z
  .object({
    kind: z.enum(METERED),
    unit: z.string().trim().min(1),
    minPricePerUnit: z.coerce.number().int().min(0),
    maxPricePerUnit: z.coerce.number().int().min(0),
  })
  .refine((v) => v.minPricePerUnit <= v.maxPricePerUnit, {
    message: "Minimum must be less than or equal to maximum",
    path: ["maxPricePerUnit"],
  });

export async function upsertUtilityBound(session: SessionContext, raw: unknown) {
  assertAdmin(session);
  const input = upsertSchema.parse(raw);

  return db.utilityRateBound.upsert({
    where: { kind: input.kind },
    create: {
      kind: input.kind,
      unit: input.unit,
      minPricePerUnit: input.minPricePerUnit,
      maxPricePerUnit: input.maxPricePerUnit,
    },
    update: {
      unit: input.unit,
      minPricePerUnit: input.minPricePerUnit,
      maxPricePerUnit: input.maxPricePerUnit,
    },
  });
}
