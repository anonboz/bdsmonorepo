// FAT service: flat monthly fees (internet, trash, parking, …).
//
// PropertyFee = the property's default. LeaseFee = the lease's own copy, which
// is what actually gets billed (see invoice.service › generateInvoice).
//
// Inheritance rules:
//   - A new lease copies its property's fees (copyPropertyFeesToLease, called
//     from createLease inside the lease's transaction).
//   - Creating / editing / deleting a PropertyFee propagates ONLY to DRAFT
//     leases (no rent running yet), and only to their fees that weren't
//     customized on the lease. Active and later leases keep their copy.
//   - Editing a LeaseFee marks it `customized`, so property changes stop
//     overwriting it. Lease fees can be changed on draft/active leases only.
//
// Every function takes the SessionContext first and scopes by
// session.organizationId ONLY. Money is integer cents.

import { db, type Prisma } from "@repo/db";
import type { LeaseStatus } from "@repo/db";
import { ConflictError, FEE_KINDS, NotFoundError } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

const MAX_FEE_CENTS = 1_000_000_000_00; // sanity cap: 1 billion in currency units

const feeFields = {
  kind: z.enum(FEE_KINDS),
  label: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => (v ? v : undefined)),
  amount: z.number().int().min(0).max(MAX_FEE_CENTS), // cents per month
};

/** `other` needs a label — otherwise the bill line would just say "Other". */
const feeSchema = z.object(feeFields).refine((f) => f.kind !== "other" || !!f.label, {
  message: "A label is required for an 'other' fee",
  path: ["label"],
});

const feePatchSchema = z
  .object({
    label: feeFields.label,
    amount: feeFields.amount.optional(),
  })
  .refine((f) => f.label !== undefined || f.amount !== undefined, {
    message: "Nothing to update",
  });

export type FeeRow = {
  id: string;
  kind: (typeof FEE_KINDS)[number];
  label: string | null;
  amount: number;
};

const FEE_SELECT = { id: true, kind: true, label: true, amount: true } as const;

/** Leases whose fees can still be changed. Ended/terminated/renewed are history. */
const EDITABLE_LEASE_STATUSES: readonly LeaseStatus[] = ["draft", "active"];

// ── Ownership helpers ────────────────────────────────────────────────────────

async function assertProperty(session: SessionContext, propertyId: string) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, organizationId: true },
  });
  if (!property || property.organizationId !== session.organizationId) {
    throw new NotFoundError("Property not found");
  }
  return property;
}

async function assertPropertyFee(session: SessionContext, feeId: string) {
  const fee = await db.propertyFee.findUnique({ where: { id: feeId } });
  if (!fee || fee.organizationId !== session.organizationId) {
    throw new NotFoundError("Fee not found");
  }
  return fee;
}

async function assertEditableLease(session: SessionContext, leaseId: string) {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    select: { id: true, organizationId: true, status: true },
  });
  if (!lease || lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }
  if (!EDITABLE_LEASE_STATUSES.includes(lease.status)) {
    throw new ConflictError(`Fees can't be changed on a ${lease.status} lease`);
  }
  return lease;
}

async function assertLeaseFee(session: SessionContext, feeId: string) {
  const fee = await db.leaseFee.findUnique({
    where: { id: feeId },
    include: { lease: { select: { status: true } } },
  });
  if (!fee || fee.organizationId !== session.organizationId) {
    throw new NotFoundError("Fee not found");
  }
  if (!EDITABLE_LEASE_STATUSES.includes(fee.lease.status)) {
    throw new ConflictError(`Fees can't be changed on a ${fee.lease.status} lease`);
  }
  return fee;
}

/** Draft leases on any unit of this property — the only ones property edits reach. */
function draftLeasesOf(propertyId: string): Prisma.LeaseWhereInput {
  return { status: "draft", unit: { propertyId } };
}

// ── Property fees ────────────────────────────────────────────────────────────

export async function listPropertyFees(
  session: SessionContext,
  propertyId: string,
): Promise<FeeRow[]> {
  await assertProperty(session, propertyId);
  return db.propertyFee.findMany({
    where: { propertyId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
    select: FEE_SELECT,
  });
}

export async function createPropertyFee(session: SessionContext, propertyId: string, raw: unknown) {
  const input = feeSchema.parse(raw);
  await assertProperty(session, propertyId);

  return db.$transaction(async (tx) => {
    const fee = await tx.propertyFee.create({
      data: {
        organizationId: session.organizationId,
        propertyId,
        kind: input.kind,
        label: input.label ?? null,
        amount: input.amount,
      },
      select: FEE_SELECT,
    });

    // Draft leases on this property pick the new default up too.
    const drafts = await tx.lease.findMany({
      where: { organizationId: session.organizationId, ...draftLeasesOf(propertyId) },
      select: { id: true },
    });
    if (drafts.length > 0) {
      await tx.leaseFee.createMany({
        data: drafts.map((l) => ({
          organizationId: session.organizationId,
          leaseId: l.id,
          propertyFeeId: fee.id,
          kind: input.kind,
          label: input.label ?? null,
          amount: input.amount,
        })),
      });
    }
    return { fee, draftLeasesUpdated: drafts.length };
  });
}

export async function updatePropertyFee(session: SessionContext, feeId: string, raw: unknown) {
  const input = feePatchSchema.parse(raw);
  const existing = await assertPropertyFee(session, feeId);
  const label = input.label !== undefined ? input.label : existing.label;
  if (existing.kind === "other" && !label) {
    throw new ConflictError("A label is required for an 'other' fee");
  }
  const data = {
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.amount !== undefined ? { amount: input.amount } : {}),
  };

  return db.$transaction(async (tx) => {
    const fee = await tx.propertyFee.update({ where: { id: feeId }, data, select: FEE_SELECT });
    // Push the change to draft leases' copies the landlord hasn't customized.
    const { count } = await tx.leaseFee.updateMany({
      where: {
        propertyFeeId: feeId,
        organizationId: session.organizationId,
        customized: false,
        lease: draftLeasesOf(existing.propertyId),
      },
      data,
    });
    return { fee, draftLeasesUpdated: count };
  });
}

export async function deletePropertyFee(session: SessionContext, feeId: string) {
  const existing = await assertPropertyFee(session, feeId);

  return db.$transaction(async (tx) => {
    // Draft leases drop their untouched copy; every other copy survives
    // (its propertyFeeId is nulled by the FK's ON DELETE SET NULL).
    const { count } = await tx.leaseFee.deleteMany({
      where: {
        propertyFeeId: feeId,
        organizationId: session.organizationId,
        customized: false,
        lease: draftLeasesOf(existing.propertyId),
      },
    });
    await tx.propertyFee.delete({ where: { id: feeId } });
    return { draftLeasesUpdated: count };
  });
}

/**
 * Copy a property's fees onto a just-created lease. Call inside the lease's
 * transaction with a property already asserted to belong to `organizationId`.
 */
export async function copyPropertyFeesToLease(
  tx: Prisma.TransactionClient,
  organizationId: string,
  propertyId: string,
  leaseId: string,
) {
  const fees = await tx.propertyFee.findMany({
    where: { propertyId, organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (fees.length === 0) return;
  await tx.leaseFee.createMany({
    data: fees.map((f) => ({
      organizationId,
      leaseId,
      propertyFeeId: f.id,
      kind: f.kind,
      label: f.label,
      amount: f.amount,
    })),
  });
}

// ── Lease fees ───────────────────────────────────────────────────────────────

export type LeaseFeeRow = FeeRow & { fromProperty: boolean; customized: boolean };

export async function listLeaseFees(
  session: SessionContext,
  leaseId: string,
): Promise<LeaseFeeRow[]> {
  const lease = await db.lease.findUnique({
    where: { id: leaseId },
    select: { organizationId: true },
  });
  if (!lease || lease.organizationId !== session.organizationId) {
    throw new NotFoundError("Lease not found");
  }
  const rows = await db.leaseFee.findMany({
    where: { leaseId, organizationId: session.organizationId },
    orderBy: { createdAt: "asc" },
    select: { ...FEE_SELECT, propertyFeeId: true, customized: true },
  });
  return rows.map(({ propertyFeeId, ...r }) => ({ ...r, fromProperty: propertyFeeId !== null }));
}

export async function createLeaseFee(session: SessionContext, leaseId: string, raw: unknown) {
  const input = feeSchema.parse(raw);
  await assertEditableLease(session, leaseId);
  // A lease-only fee: no propertyFeeId, so property edits never touch it.
  return db.leaseFee.create({
    data: {
      organizationId: session.organizationId,
      leaseId,
      kind: input.kind,
      label: input.label ?? null,
      amount: input.amount,
      customized: true,
    },
    select: FEE_SELECT,
  });
}

export async function updateLeaseFee(session: SessionContext, feeId: string, raw: unknown) {
  const input = feePatchSchema.parse(raw);
  const existing = await assertLeaseFee(session, feeId);
  const label = input.label !== undefined ? input.label : existing.label;
  if (existing.kind === "other" && !label) {
    throw new ConflictError("A label is required for an 'other' fee");
  }
  // Editing on the lease detaches it from future property changes.
  return db.leaseFee.update({
    where: { id: feeId },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      customized: true,
    },
    select: FEE_SELECT,
  });
}

export async function deleteLeaseFee(session: SessionContext, feeId: string) {
  await assertLeaseFee(session, feeId);
  await db.leaseFee.delete({ where: { id: feeId } });
  return { id: feeId };
}
