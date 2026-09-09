// FAT service: business logic + Prisma for this org's listings and their
// photos. Scopes by session.organizationId ONLY (never body/params/query).

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

const LISTING_STATUSES = ["draft", "published", "paused", "rented", "archived"] as const;

export type OrgListingRow = {
  id: string;
  title: string;
  status: string;
  unitLabel: string;
  propertyName: string;
  photoCount: number;
  createdAt: string; // ISO
};

export type ListingPhotoRow = {
  id: string;
  url: string;
  sortOrder: number;
  createdAt: string; // ISO
};

export type OrgListingDetail = {
  id: string;
  unitId: string;
  title: string;
  description: string | null;
  rentAmount: number; // cents
  depositAmount: number; // cents
  availableFrom: string | null; // ISO
  status: string;
  publishedAt: string | null; // ISO
  unitLabel: string;
  propertyName: string;
  photos: ListingPhotoRow[];
};

function toPhotoRow(p: {
  id: string;
  url: string;
  sortOrder: number;
  createdAt: Date;
}): ListingPhotoRow {
  return { id: p.id, url: p.url, sortOrder: p.sortOrder, createdAt: p.createdAt.toISOString() };
}

// ── List (this org's listings) ────────────────────────────────────────────

export async function listOrgListings(session: SessionContext): Promise<OrgListingRow[]> {
  const rows = await db.listing.findMany({
    where: { organizationId: session.organizationId }, // tenant scope — never optional
    orderBy: { createdAt: "desc" },
    include: {
      unit: { select: { label: true, property: { select: { name: true } } } },
      _count: { select: { photos: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    unitLabel: r.unit.label,
    propertyName: r.unit.property.name,
    photoCount: r._count.photos,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ── Read one (ownership-checked) ────────────────────────────────────────────

export async function getOrgListing(
  session: SessionContext,
  listingId: string,
): Promise<OrgListingDetail> {
  const listing = await db.listing.findUnique({
    where: { id: listingId },
    include: {
      unit: { select: { label: true, property: { select: { name: true } } } },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!listing || listing.organizationId !== session.organizationId) {
    throw new NotFoundError("Listing not found");
  }

  return {
    id: listing.id,
    unitId: listing.unitId,
    title: listing.title,
    description: listing.description,
    rentAmount: listing.rentAmount,
    depositAmount: listing.depositAmount,
    availableFrom: listing.availableFrom?.toISOString() ?? null,
    status: listing.status,
    publishedAt: listing.publishedAt?.toISOString() ?? null,
    unitLabel: listing.unit.label,
    propertyName: listing.unit.property.name,
    photos: listing.photos.map(toPhotoRow),
  };
}

// ── Create ────────────────────────────────────────────────────────────────

const createListingSchema = z.object({
  unitId: z.string().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  rentAmount: z.coerce.number().int().min(0), // cents
  depositAmount: z.coerce.number().int().min(0).default(0), // cents
  availableFrom: z.string().datetime().optional(),
});

export async function createListing(
  session: SessionContext,
  raw: unknown,
): Promise<{ id: string }> {
  const input = createListingSchema.parse(raw);

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

  const listing = await db.listing.create({
    data: {
      organizationId: session.organizationId, // from session ONLY
      unitId: input.unitId,
      title: input.title,
      description: input.description,
      rentAmount: input.rentAmount,
      depositAmount: input.depositAmount,
      availableFrom: input.availableFrom ? new Date(input.availableFrom) : undefined,
      status: "draft",
    },
  });
  return { id: listing.id };
}

// ── Update (fields + status) ─────────────────────────────────────────────────
// unitId isn't editable — moving a listing to a different unit is really
// "delete and create a new one," since the unit is what the listing describes.

const updateListingSchema = z.object({
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).nullable().optional(),
  rentAmount: z.coerce.number().int().min(0).optional(),
  depositAmount: z.coerce.number().int().min(0).optional(),
  availableFrom: z.string().datetime().nullable().optional(),
  status: z.enum(LISTING_STATUSES).optional(),
});

export async function updateListing(
  session: SessionContext,
  id: string,
  raw: unknown,
): Promise<{ id: string }> {
  const input = updateListingSchema.parse(raw);

  const existing = await db.listing.findUnique({ where: { id } });
  if (!existing || existing.organizationId !== session.organizationId) {
    throw new NotFoundError("Listing not found");
  }

  // First transition into "published" stamps publishedAt; later status
  // changes (pause/republish/archive) leave it as the original publish date.
  const stampPublishedAt =
    input.status === "published" && existing.status !== "published" && existing.publishedAt == null;

  await db.listing.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.rentAmount !== undefined ? { rentAmount: input.rentAmount } : {}),
      ...(input.depositAmount !== undefined ? { depositAmount: input.depositAmount } : {}),
      ...(input.availableFrom !== undefined
        ? { availableFrom: input.availableFrom ? new Date(input.availableFrom) : null }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(stampPublishedAt ? { publishedAt: new Date() } : {}),
    },
  });
  return { id };
}

// ── Delete ────────────────────────────────────────────────────────────────

export async function deleteListing(
  session: SessionContext,
  id: string,
): Promise<{ id: string; photoUrls: string[] }> {
  const listing = await db.listing.findUnique({
    where: { id },
    include: { photos: { select: { url: true } } },
  });
  if (!listing || listing.organizationId !== session.organizationId) {
    throw new NotFoundError("Listing not found");
  }

  await db.listing.delete({ where: { id } }); // cascades ListingPhoto rows
  return { id, photoUrls: listing.photos.map((p) => p.url) };
}

// ── Add a photo ──────────────────────────────────────────────────────────────

const addPhotoSchema = z.object({ url: z.string().url() });

export async function addListingPhoto(
  session: SessionContext,
  listingId: string,
  raw: unknown,
): Promise<ListingPhotoRow> {
  const { url } = addPhotoSchema.parse(raw);

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, organizationId: true },
  });
  if (!listing || listing.organizationId !== session.organizationId) {
    throw new NotFoundError("Listing not found");
  }

  const last = await db.listingPhoto.findFirst({
    where: { listingId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const photo = await db.listingPhoto.create({
    data: { listingId, url, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return toPhotoRow(photo);
}

// ── Remove a photo ───────────────────────────────────────────────────────────

export async function removeListingPhoto(
  session: SessionContext,
  photoId: string,
): Promise<{ id: string; url: string }> {
  const photo = await db.listingPhoto.findUnique({
    where: { id: photoId },
    include: { listing: { select: { organizationId: true } } },
  });
  // Assert ownership via the parent listing's org — a cross-org photo id
  // (or a stale one from a deleted listing) is reported as "not found".
  if (!photo || photo.listing.organizationId !== session.organizationId) {
    throw new NotFoundError("Photo not found");
  }

  await db.listingPhoto.delete({ where: { id: photoId } });
  return { id: photo.id, url: photo.url };
}
