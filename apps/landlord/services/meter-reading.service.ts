// FAT service: business logic + Prisma for landlord-recorded meter readings.
// A reading is a cumulative meter value (like an odometer) captured at a point
// in time for one unit + metered utility; consumption for billing is the delta
// between two consecutive readings for the same (unitId, kind), computed here
// and reused by invoice.service.ts. Scopes by session.organizationId ONLY.

import { db } from "@repo/db";
import { ConflictError, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

// Metered utilities a reading can be recorded for. `rent`/`other` aren't metered.
const METERED = ["water", "electricity"] as const;
type Metered = (typeof METERED)[number];

export type UnitOption = { id: string; label: string; propertyName: string };

export type MeterReadingRow = {
  id: string;
  unitId: string;
  unitLabel: string;
  propertyName: string;
  kind: Metered;
  value: number;
  readingDate: string; // ISO
  isReset: boolean; // meter was replaced/rolled over — a fresh baseline, not a real drop
  note: string | null;
  photoUrl: string | null;
  previousValue: number | null; // the immediately-prior reading for this unit+kind; null if a reset
  consumption: number | null; // value - previousValue; null if no prior reading, or this is a reset
  billed: boolean; // already used as the "current" reading of an invoice line item
  createdAt: string; // ISO
};

// ── Units this org can record readings for (form dropdown) ──────────────────

export async function listUnitOptions(session: SessionContext): Promise<UnitOption[]> {
  const units = await db.unit.findMany({
    where: { property: { organizationId: session.organizationId } },
    orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
    select: { id: true, label: true, property: { select: { name: true } } },
  });
  return units.map((u) => ({ id: u.id, label: u.label, propertyName: u.property.name }));
}

// ── Overdue nudge (units with no reading yet this calendar month) ───────────
// Readings stay free-form (any date, any frequency, no cycle enforced) — this
// is purely informational, surfaced as a banner so a monthly cadence doesn't
// silently slip for a few units.

export type OverdueReading = {
  unitId: string;
  unitLabel: string;
  propertyName: string;
  kind: Metered;
  lastReadingDate: string | null; // most recent reading before this month, if any
};

export async function listOverdueReadings(session: SessionContext): Promise<OverdueReading[]> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const units = await db.unit.findMany({
    where: { property: { organizationId: session.organizationId } },
    orderBy: [{ property: { name: "asc" } }, { label: "asc" }],
    select: { id: true, label: true, property: { select: { name: true } } },
  });
  if (units.length === 0) return [];

  const readings = await db.meterReading.findMany({
    where: { organizationId: session.organizationId, unitId: { in: units.map((u) => u.id) } },
    orderBy: { readingDate: "desc" }, // most recent first, within each unit+kind below too
    select: { unitId: true, kind: true, readingDate: true },
  });

  const overdue: OverdueReading[] = [];
  for (const unit of units) {
    for (const kind of METERED) {
      const forUnitKind = readings.filter((r) => r.unitId === unit.id && r.kind === kind);
      const hasThisMonth = forUnitKind.some((r) => r.readingDate >= monthStart);
      if (!hasThisMonth) {
        overdue.push({
          unitId: unit.id,
          unitLabel: unit.label,
          propertyName: unit.property.name,
          kind,
          lastReadingDate: forUnitKind[0]?.readingDate.toISOString() ?? null,
        });
      }
    }
  }
  return overdue;
}

// ── List (this org's readings, most recent first) ────────────────────────────

const listSchema = z.object({
  unitId: z.string().min(1).optional(),
  unbilledOnly: z.coerce.boolean().default(false),
});

export async function listMeterReadings(
  session: SessionContext,
  rawQuery: unknown,
): Promise<MeterReadingRow[]> {
  const { unitId, unbilledOnly } = listSchema.parse(rawQuery);

  const rows = await db.meterReading.findMany({
    where: {
      organizationId: session.organizationId, // tenant scope — never optional
      ...(unitId ? { unitId } : {}),
    },
    orderBy: [{ unitId: "asc" }, { kind: "asc" }, { readingDate: "asc" }],
    include: { unit: { select: { label: true, property: { select: { name: true } } } } },
  });

  // Walk each (unitId, kind) group in date order so every row can see its
  // immediately-prior reading without a query per row. A reset reading always
  // shows as its own baseline (previousValue null) even though it still
  // becomes the baseline the *next* reading diffs against below.
  const previous = new Map<string, number>();
  const withPrev: MeterReadingRow[] = rows.map((r) => {
    const key = `${r.unitId}:${r.kind}`;
    const previousValue = r.isReset ? null : (previous.get(key) ?? null);
    previous.set(key, r.value);
    return {
      id: r.id,
      unitId: r.unitId,
      unitLabel: r.unit.label,
      propertyName: r.unit.property.name,
      kind: r.kind as Metered,
      value: r.value,
      readingDate: r.readingDate.toISOString(),
      isReset: r.isReset,
      note: r.note,
      photoUrl: r.photoUrl,
      previousValue,
      consumption: previousValue != null ? Math.round((r.value - previousValue) * 100) / 100 : null,
      billed: r.lineItemId != null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  // Reset readings have no delta of their own (previousValue is always null for
  // them), so they're never billable — exclude them from the unbilled picker.
  const filtered = unbilledOnly ? withPrev.filter((r) => !r.billed && !r.isReset) : withPrev;
  return filtered.sort((a, b) => (a.readingDate < b.readingDate ? 1 : -1)); // most recent first
}

// ── Record a reading ──────────────────────────────────────────────────────────

const recordSchema = z.object({
  unitId: z.string().min(1),
  kind: z.enum(METERED),
  value: z.coerce.number().min(0),
  readingDate: z.string().datetime(),
  isReset: z.coerce.boolean().default(false), // meter replaced/rolled over — skip the below-previous check
  note: z.string().trim().min(1).max(500).optional(),
  photoUrl: z.string().url().optional(),
});

export async function recordMeterReading(session: SessionContext, raw: unknown) {
  const input = recordSchema.parse(raw);

  // Multi-tenant guard: the unit must belong to the caller's org (via its
  // property). A cross-org unit is reported as "not found".
  const unit = await db.unit.findUnique({
    where: { id: input.unitId },
    select: { id: true, property: { select: { organizationId: true } } },
  });
  if (!unit) throw new Error("UNIT_NOT_FOUND");
  if (unit.property.organizationId !== session.organizationId) {
    throw new NotFoundError("Unit not found");
  }

  // Meters don't run backwards — the new value must be at or above the most
  // recent prior reading for this unit+kind (assumes readings are recorded in
  // date order; backfilling an earlier reading between two existing ones isn't
  // validated against the later one) — unless this reading is flagged as a
  // reset (the meter was physically replaced or rolled over, so a lower value
  // is expected and legitimate).
  if (!input.isReset) {
    const prior = await db.meterReading.findFirst({
      where: {
        unitId: input.unitId,
        kind: input.kind,
        readingDate: { lt: new Date(input.readingDate) },
      },
      orderBy: { readingDate: "desc" },
    });
    if (prior && input.value < prior.value) {
      throw new ConflictError(
        `Value must be at least ${prior.value} (the previous reading, on ${prior.readingDate.toDateString()}) — check "meter reset" if the meter was replaced`,
      );
    }
  }

  // Duplicate (unitId, kind, readingDate) surfaces as Prisma P2002 → 409.
  return db.meterReading.create({
    data: {
      organizationId: session.organizationId, // from session ONLY
      unitId: input.unitId,
      kind: input.kind,
      value: input.value,
      readingDate: new Date(input.readingDate),
      isReset: input.isReset,
      note: input.note,
      photoUrl: input.photoUrl,
    },
  });
}

// ── Update (only if not yet billed) ──────────────────────────────────────────
// Unit and kind aren't editable — changing either is really "delete and record
// a new one," since they define which reading history this row belongs to.

const updateSchema = z.object({
  value: z.coerce.number().min(0),
  readingDate: z.string().datetime(),
  isReset: z.coerce.boolean().default(false),
  note: z.string().trim().max(500).nullable(), // always sent by the edit form: null clears it
  photoUrl: z.string().url().nullable(), // always sent: null removes the photo
});

export async function updateMeterReading(
  session: SessionContext,
  id: string,
  raw: unknown,
): Promise<{ photoUrlToDelete: string | null }> {
  const input = updateSchema.parse(raw);

  const existing = await db.meterReading.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.organizationId) {
    throw new NotFoundError("Reading not found");
  }
  if (existing.lineItemId) {
    throw new ConflictError("This reading has already been billed and can't be edited");
  }

  const newDate = new Date(input.readingDate);

  // Same non-decreasing invariant as recording, checked against the reading
  // immediately before the (possibly new) date — unless this edit marks it a
  // reset.
  if (!input.isReset) {
    const prior = await db.meterReading.findFirst({
      where: {
        unitId: existing.unitId,
        kind: existing.kind,
        readingDate: { lt: newDate },
        id: { not: id },
      },
      orderBy: { readingDate: "desc" },
    });
    if (prior && input.value < prior.value) {
      throw new ConflictError(
        `Value must be at least ${prior.value} (the previous reading, on ${prior.readingDate.toDateString()}) — check "meter reset" if the meter was replaced`,
      );
    }
  }

  // The other direction too: don't let an edit make the *next* reading (if
  // any, and it isn't itself a reset) look like it went backwards.
  const next = await db.meterReading.findFirst({
    where: {
      unitId: existing.unitId,
      kind: existing.kind,
      readingDate: { gt: newDate },
      id: { not: id },
    },
    orderBy: { readingDate: "asc" },
  });
  if (next && !next.isReset && input.value > next.value) {
    throw new ConflictError(
      `Value must be at most ${next.value} (the next reading, on ${next.readingDate.toDateString()})`,
    );
  }

  // Only report a blob to delete if the photo actually changed.
  const photoUrlToDelete =
    existing.photoUrl && existing.photoUrl !== input.photoUrl ? existing.photoUrl : null;

  // Changing (unitId, kind, readingDate) onto an existing row surfaces as
  // Prisma P2002 → 409.
  await db.meterReading.update({
    where: { id },
    data: {
      value: input.value,
      readingDate: newDate,
      isReset: input.isReset,
      note: input.note,
      photoUrl: input.photoUrl,
    },
  });

  return { photoUrlToDelete };
}

// ── Delete (only if not yet billed) ──────────────────────────────────────────

export async function deleteMeterReading(
  session: SessionContext,
  id: string,
): Promise<{ id: string; photoUrl: string | null }> {
  const existing = await db.meterReading.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.organizationId) {
    throw new NotFoundError("Reading not found");
  }
  if (existing.lineItemId) {
    throw new ConflictError("This reading has already been billed and can't be deleted");
  }
  await db.meterReading.delete({ where: { id } });
  return { id, photoUrl: existing.photoUrl };
}
