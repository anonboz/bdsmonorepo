// FAT service: business logic + Prisma for this org's listings and their
// photos. Scopes by session.organizationId ONLY (never body/params/query).
// Listing creation/editing isn't built yet (out of scope here) — this is
// read + photo-management only, against whatever listings already exist.

import { db } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

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
  title: string;
  status: string;
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
    title: listing.title,
    status: listing.status,
    unitLabel: listing.unit.label,
    propertyName: listing.unit.property.name,
    photos: listing.photos.map(toPhotoRow),
  };
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
