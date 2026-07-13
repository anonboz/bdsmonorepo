// FAT service: all business logic + Prisma live here; the route handler is thin.
// Every function takes the SessionContext first and scopes by
// session.organizationId ONLY. Money is integer cents.

import { db } from "@repo/db";
import type { PropertyType, UnitStatus } from "@repo/db";
import { NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

// ── Create property ──────────────────────────────────────────────────────────

const createPropertySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["apartment", "house", "condo", "townhouse", "room", "commercial"]),
  addressLine1: z.string().min(1),
  addressLine2: z.string().min(1).optional(),
  city: z.string().min(1),
  region: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
  country: z.string().min(2).max(2).default("US"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export async function createProperty(session: SessionContext, raw: unknown) {
  const input = createPropertySchema.parse(raw);

  // organizationId comes from the session ONLY — never from the body.
  return db.property.create({
    data: {
      organizationId: session.organizationId,
      name: input.name,
      type: input.type,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2,
      city: input.city,
      region: input.region,
      postalCode: input.postalCode,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
    },
  });
}

// ── List properties ──────────────────────────────────────────────────────────

const listPropertiesSchema = z.object({
  type: z.enum(["apartment", "house", "condo", "townhouse", "room", "commercial"]).optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
});

export async function listProperties(session: SessionContext, rawQuery: unknown) {
  const { type, take, skip } = listPropertiesSchema.parse(rawQuery);
  const where = {
    organizationId: session.organizationId, // tenant scope — never optional
    ...(type ? { type: type as PropertyType } : {}),
  };

  const [rows, total] = await Promise.all([
    db.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      include: { _count: { select: { units: true } } },
    }),
    db.property.count({ where }),
  ]);

  return { rows, total, take, skip };
}

// ── Read one property (ownership-checked) ────────────────────────────────────

export async function getProperty(session: SessionContext, propertyId: string) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    include: {
      units: { orderBy: { label: "asc" } },
      _count: { select: { units: true } },
    },
  });
  // Assert ownership AFTER findUnique — the load-bearing multi-tenant check.
  if (!property || property.organizationId !== session.organizationId) {
    throw new Error("PROPERTY_NOT_FOUND");
  }
  return property;
}

// ── Create unit (under an org-owned property) ────────────────────────────────

const createUnitSchema = z.object({
  propertyId: z.string().min(1),
  label: z.string().min(1), // unique within its property
  bedrooms: z.number().int().min(0).default(0),
  bathrooms: z.number().min(0).default(1),
  areaSqft: z.number().int().min(0).optional(),
  rentAmount: z.number().int().min(0), // cents
  status: z.enum(["available", "occupied", "maintenance", "offline"]).default("available"),
});

export async function createUnit(session: SessionContext, raw: unknown) {
  const input = createUnitSchema.parse(raw);

  // Multi-tenant guard: the parent property must belong to the caller's org. A
  // cross-org property is reported as "not found" so we don't leak its existence.
  const property = await db.property.findUnique({
    where: { id: input.propertyId },
    select: { id: true, organizationId: true },
  });
  if (!property) throw new Error("PROPERTY_NOT_FOUND");
  if (property.organizationId !== session.organizationId) {
    throw new NotFoundError("Property not found");
  }

  // Duplicate (propertyId, label) surfaces as Prisma P2002 → 409 in the mapper.
  return db.unit.create({
    data: {
      propertyId: input.propertyId,
      label: input.label,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      areaSqft: input.areaSqft,
      rentAmount: input.rentAmount,
      status: input.status as UnitStatus,
    },
  });
}
