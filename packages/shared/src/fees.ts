// @repo/shared/fees — flat monthly fees (internet, trash, …) on properties and
// leases. Mirrors the Prisma `FeeKind` enum; every value also exists in
// `InvoiceLineKind`, so a fee bills as a line item of the same kind.

export const FEE_KINDS = ["internet", "trash", "parking", "cleaning", "other"] as const;
export type FeeKindKey = (typeof FEE_KINDS)[number];

export function isFeeKind(value: string): value is FeeKindKey {
  return (FEE_KINDS as readonly string[]).includes(value);
}
