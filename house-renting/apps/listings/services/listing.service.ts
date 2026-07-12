// FAT service: all business logic + Prisma live here; the route handler is thin.
//
// PUBLIC search index — the Listing model is the documented multi-tenant
// exception: this browse surface is intentionally GLOBAL and cross-org, so
// there is NO `organizationId` scoping here. Only `status: "published"`
// listings are ever exposed. Money is integer cents.

import { db } from "@repo/db";
import { z } from "zod";

// ── List (public search) ─────────────────────────────────────────────────────

const listPublicListingsSchema = z.object({
  city: z.string().min(1).optional(),
  minRent: z.coerce.number().int().min(0).optional(), // cents
  maxRent: z.coerce.number().int().min(0).optional(), // cents
  take: z.coerce.number().int().min(1).max(100).default(24),
  skip: z.coerce.number().int().min(0).default(0),
});

const LISTING_DETAIL_INCLUDE = {
  unit: {
    select: {
      label: true,
      bedrooms: true,
      bathrooms: true,
      property: { select: { name: true, city: true, region: true, type: true } },
    },
  },
} as const;

export async function listPublicListings(rawQuery: unknown) {
  const { city, minRent, maxRent, take, skip } = listPublicListingsSchema.parse(rawQuery);

  const rentAmount =
    minRent !== undefined || maxRent !== undefined
      ? {
          ...(minRent !== undefined ? { gte: minRent } : {}),
          ...(maxRent !== undefined ? { lte: maxRent } : {}),
        }
      : undefined;

  const where = {
    status: "published" as const, // public index — only published listings
    ...(city
      ? { unit: { property: { city: { contains: city, mode: "insensitive" as const } } } }
      : {}),
    ...(rentAmount ? { rentAmount } : {}),
  };

  const [rows, total] = await Promise.all([
    db.listing.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take,
      skip,
      include: LISTING_DETAIL_INCLUDE,
    }),
    db.listing.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Read one (public) ────────────────────────────────────────────────────────

export async function getPublicListing(id: string) {
  const listing = await db.listing.findUnique({
    where: { id },
    include: LISTING_DETAIL_INCLUDE,
  });
  // Only published listings are publicly visible; anything else is "not found"
  // so we never leak draft/paused/archived inventory.
  if (!listing || listing.status !== "published") {
    throw new Error("LISTING_NOT_FOUND");
  }
  return listing;
}
