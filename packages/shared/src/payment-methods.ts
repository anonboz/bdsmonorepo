// @repo/shared/payment-methods — the platform's vocabulary of tenant payment
// methods. The admin's PaymentMethodCatalog row per key says whether a method
// is enabled platform-wide; each org opts into enabled methods
// (OrgPaymentSettings.acceptedMethods); tenants see the intersection.

export const PAYMENT_METHOD_KEYS = ["bank_transfer", "cash", "card", "ewallet", "points"] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export function isPaymentMethodKey(value: unknown): value is PaymentMethodKey {
  return typeof value === "string" && (PAYMENT_METHOD_KEYS as readonly string[]).includes(value);
}

/**
 * Methods with a working rail today. A tenant can report one of these as paid
 * (→ pending Payment the landlord confirms). Everything else in the catalog is
 * shown to tenants as "coming soon" even when the admin enables it.
 */
export const MANUAL_PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
] as const satisfies readonly PaymentMethodKey[];

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === "string" && (MANUAL_PAYMENT_METHODS as readonly string[]).includes(value);
}

/** English labels for the staff-facing apps (tenant app localizes its own). */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethodKey, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  ewallet: "E-wallet",
  points: "Points",
};
