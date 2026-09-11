// FAT service: how this org accepts rent payments. The admin's catalog says
// which methods exist platform-wide; the org picks the ones it accepts
// (default: bank transfer) and, for bank transfer, enters the receiving
// account used to render a VietQR code on tenants' bills. One row per org,
// upserted. Scopes by session.organizationId ONLY.

import { db } from "@repo/db";
import {
  ConflictError,
  findVnBank,
  isPaymentMethodKey,
  PAYMENT_METHOD_KEYS,
  type PaymentMethodKey,
} from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

export type PaymentSettingsRow = {
  /** Admin-enabled methods in display order — the only ones the org can pick. */
  available: PaymentMethodKey[];
  acceptedMethods: PaymentMethodKey[];
  cashInstructions: string | null;
  bankBin: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
};

const DEFAULT_ACCEPTED: PaymentMethodKey[] = ["bank_transfer"];

async function availableMethods(): Promise<PaymentMethodKey[]> {
  const rows = await db.paymentMethodCatalog.findMany({
    where: { enabled: true },
    orderBy: { sortOrder: "asc" },
    select: { key: true },
  });
  return rows.map((r) => r.key).filter(isPaymentMethodKey);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getPaymentSettings(session: SessionContext): Promise<PaymentSettingsRow> {
  const [available, row] = await Promise.all([
    availableMethods(),
    db.orgPaymentSettings.findUnique({ where: { organizationId: session.organizationId } }),
  ]);
  return {
    available,
    acceptedMethods: (row?.acceptedMethods ?? DEFAULT_ACCEPTED).filter(isPaymentMethodKey),
    cashInstructions: row?.cashInstructions ?? null,
    bankBin: row?.bankBin ?? null,
    bankName: row?.bankName ?? null,
    bankAccountNo: row?.bankAccountNo ?? null,
    bankAccountName: row?.bankAccountName ?? null,
  };
}

// ── Upsert ───────────────────────────────────────────────────────────────────

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const upsertSchema = z
  .object({
    acceptedMethods: z.array(z.enum(PAYMENT_METHOD_KEYS)),
    cashInstructions: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
    bankBin: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{6}$/, "Pick a bank")
        .nullable()
        .optional(),
    ),
    bankAccountNo: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{6,19}$/, "Account number must be 6–19 digits")
        .nullable()
        .optional(),
    ),
    bankAccountName: z.preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[A-Za-z0-9 ]+$/, "Account name: letters, digits and spaces only (no accents)")
        .nullable()
        .optional(),
    ),
  })
  .superRefine((v, ctx) => {
    if (!v.acceptedMethods.includes("bank_transfer")) return;
    if (!v.bankBin) ctx.addIssue({ code: "custom", path: ["bankBin"], message: "Pick a bank" });
    if (!v.bankAccountNo)
      ctx.addIssue({ code: "custom", path: ["bankAccountNo"], message: "Account number required" });
    if (!v.bankAccountName)
      ctx.addIssue({ code: "custom", path: ["bankAccountName"], message: "Account name required" });
    if (v.bankBin && !findVnBank(v.bankBin))
      ctx.addIssue({ code: "custom", path: ["bankBin"], message: "Unknown bank" });
  });

export async function upsertPaymentSettings(
  session: SessionContext,
  raw: unknown,
): Promise<PaymentSettingsRow> {
  const input = upsertSchema.parse(raw);

  // Only admin-enabled methods can be accepted; reject anything else loudly
  // rather than silently dropping it.
  const available = await availableMethods();
  const notAvailable = input.acceptedMethods.filter((m) => !available.includes(m));
  if (notAvailable.length > 0) {
    throw new ConflictError(`Not available on this platform: ${notAvailable.join(", ")}`);
  }

  const bank = input.bankBin ? findVnBank(input.bankBin) : null;
  const data = {
    acceptedMethods: [...new Set(input.acceptedMethods)],
    cashInstructions: input.cashInstructions ?? null,
    bankBin: input.bankBin ?? null,
    bankName: bank?.name ?? null,
    bankAccountNo: input.bankAccountNo ?? null,
    bankAccountName: input.bankAccountName?.toUpperCase() ?? null,
  };
  await db.orgPaymentSettings.upsert({
    where: { organizationId: session.organizationId }, // from session ONLY
    create: { organizationId: session.organizationId, ...data },
    update: data,
  });
  return getPaymentSettings(session);
}
