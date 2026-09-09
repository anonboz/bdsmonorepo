// FAT service: unit inspections (move-in / move-out condition records) and
// their photos, reached through a lease. Scopes by session.organizationId ONLY
// (never body/params) and asserts ownership after every findUnique — a
// cross-org row is reported as "not found" so we don't leak its existence.
//
// Inspection rows hang off the Unit; "this lease's inspections" is derived via
// leaseInspectionWindow from @repo/shared (see the note there). Photos are
// Document rows of type inspection_photo with entityType "Inspection".

import { db, type InspectionType } from "@repo/db";
import { INSPECTION_TYPES, leaseInspectionWindow, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

export type InspectionPhotoRow = { id: string; url: string; createdAt: string };

export type InspectionRow = {
  id: string;
  type: InspectionType;
  completedAt: string | null; // ISO
  notes: string | null;
  createdAt: string; // ISO
  photos: InspectionPhotoRow[];
};

const PHOTO_WHERE = { type: "inspection_photo", entityType: "Inspection" } as const;

function toPhotoRow(d: { id: string; url: string; createdAt: Date }): InspectionPhotoRow {
  return { id: d.id, url: d.url, createdAt: d.createdAt.toISOString() };
}

function toRow(
  i: {
    id: string;
    type: InspectionType;
    completedAt: Date | null;
    notes: string | null;
    createdAt: Date;
  },
  photos: InspectionPhotoRow[],
): InspectionRow {
  return {
    id: i.id,
    type: i.type,
    completedAt: i.completedAt?.toISOString() ?? null,
    notes: i.notes,
    createdAt: i.createdAt.toISOString(),
    photos,
  };
}

// ── Ownership helpers ────────────────────────────────────────────────────────

async function getOrgLease(session: SessionContext, leaseId: string) {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    select: { id: true, unitId: true, organizationId: true, createdAt: true },
  });
  if (!lease || lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }
  return lease;
}

/** Inspection → unit → property → org is the ownership chain. */
async function getOrgInspection(session: SessionContext, id: string) {
  const inspection = await db.inspection.findUnique({
    where: { id },
    include: { unit: { select: { property: { select: { organizationId: true } } } } },
  });
  if (!inspection || inspection.unit.property.organizationId !== session.organizationId) {
    throw new NotFoundError("Inspection not found");
  }
  return inspection;
}

async function photosFor(organizationId: string, inspectionIds: string[]) {
  if (inspectionIds.length === 0) return [];
  return db.document.findMany({
    where: { organizationId, ...PHOTO_WHERE, entityId: { in: inspectionIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, url: true, createdAt: true, entityId: true },
  });
}

// ── List (a lease's inspections, with photos) ────────────────────────────────

export async function listLeaseInspections(
  session: SessionContext,
  leaseId: string,
): Promise<InspectionRow[]> {
  const lease = await getOrgLease(session, leaseId);
  const next = await db.lease.findFirst({
    where: { unitId: lease.unitId, createdAt: { gt: lease.createdAt } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  const rows = await db.inspection.findMany({
    where: {
      unitId: lease.unitId,
      createdAt: leaseInspectionWindow(lease.createdAt, next?.createdAt ?? null),
    },
    orderBy: { createdAt: "asc" },
  });
  const docs = await photosFor(
    session.organizationId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => toRow(r, docs.filter((d) => d.entityId === r.id).map(toPhotoRow)));
}

// ── Create ───────────────────────────────────────────────────────────────────

const createSchema = z.object({
  type: z.enum(INSPECTION_TYPES),
  notes: z.string().trim().max(2000).optional(),
});

/** Record an inspection for a lease's unit. It's "completed" as of now. */
export async function createInspection(
  session: SessionContext,
  leaseId: string,
  raw: unknown,
): Promise<InspectionRow> {
  const input = createSchema.parse(raw);
  const lease = await getOrgLease(session, leaseId);
  const created = await db.inspection.create({
    data: {
      unitId: lease.unitId,
      type: input.type,
      notes: input.notes || null,
      completedAt: new Date(),
    },
  });
  return toRow(created, []);
}

// ── Update notes ─────────────────────────────────────────────────────────────

const updateSchema = z.object({ notes: z.string().trim().max(2000).nullable() });

export async function updateInspectionNotes(
  session: SessionContext,
  id: string,
  raw: unknown,
): Promise<InspectionRow> {
  const input = updateSchema.parse(raw);
  await getOrgInspection(session, id);
  const updated = await db.inspection.update({
    where: { id },
    data: { notes: input.notes || null },
  });
  const docs = await photosFor(session.organizationId, [id]);
  return toRow(updated, docs.map(toPhotoRow));
}

// ── Delete (returns photo URLs so the route can clear storage) ───────────────

export async function deleteInspection(
  session: SessionContext,
  id: string,
): Promise<{ id: string; photoUrls: string[] }> {
  await getOrgInspection(session, id);
  const docs = await photosFor(session.organizationId, [id]);
  await db.$transaction([
    db.document.deleteMany({
      where: { organizationId: session.organizationId, ...PHOTO_WHERE, entityId: id },
    }),
    db.inspection.delete({ where: { id } }),
  ]);
  return { id, photoUrls: docs.map((d) => d.url) };
}

// ── Photos ───────────────────────────────────────────────────────────────────

const addPhotoSchema = z.object({ url: z.string().url() });

export async function addInspectionPhoto(
  session: SessionContext,
  inspectionId: string,
  raw: unknown,
): Promise<InspectionPhotoRow> {
  const { url } = addPhotoSchema.parse(raw);
  await getOrgInspection(session, inspectionId);
  const doc = await db.document.create({
    data: {
      organizationId: session.organizationId, // from session ONLY
      uploadedByUserId: session.userId,
      ...PHOTO_WHERE,
      entityId: inspectionId,
      url,
    },
  });
  return toPhotoRow(doc);
}

export async function removeInspectionPhoto(
  session: SessionContext,
  photoId: string,
): Promise<{ id: string; url: string }> {
  const doc = await db.document.findUnique({ where: { id: photoId } });
  if (!doc || doc.organizationId !== session.organizationId || doc.type !== "inspection_photo") {
    throw new NotFoundError("Photo not found");
  }
  await db.document.delete({ where: { id: photoId } });
  return { id: doc.id, url: doc.url };
}
