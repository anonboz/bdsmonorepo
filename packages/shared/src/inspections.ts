// @repo/shared/inspections — how an Inspection relates to a Lease.
//
// Schema note: `Inspection` hangs off a Unit, not a Lease. "This lease's
// inspections" is therefore DERIVED: the inspections recorded on the unit
// after this lease was created and before the NEXT lease on the same unit was
// created. Draft/active leases on one unit can't overlap, and inspections are
// only ever recorded from a lease's page, so the window is unambiguous.
// Shared so the landlord app (writer) and tenant app (reader) agree exactly.

export const INSPECTION_TYPES = ["move_in", "move_out", "routine", "maintenance"] as const;
export type InspectionKind = (typeof INSPECTION_TYPES)[number];

/** A Prisma-shaped `createdAt` filter selecting a lease's inspections. */
export function leaseInspectionWindow(
  leaseCreatedAt: Date,
  nextLeaseCreatedAt: Date | null,
): { gte: Date; lt?: Date } {
  return nextLeaseCreatedAt
    ? { gte: leaseCreatedAt, lt: nextLeaseCreatedAt }
    : { gte: leaseCreatedAt };
}
