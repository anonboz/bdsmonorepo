// FAT service: how this org accepts rent payments. Tenants see these settings
// on a bill: which methods are on, cash instructions, and the receiving bank
// account used to render a VietQR transfer code. One row per org, upserted;
// no row means "cash only, no instructions". Scopes by session.organizationId
// ONLY.

import { db } from "@repo/db";
import { findVnBank } from "@repo/shared";
import { z } from "zod";

import type { SessionContext } from "@/lib/session";

export type PaymentSettingsRow = {
  acceptCash: boolean;
  acceptBankTransfer: boolean;
  cashInstructions: string | null;
  bankBin: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
};

const DEFAULTS: PaymentSettingsRow = {
  acceptCash: true,
  acceptBankTransfer: false,
  cashInstructions: null,
  bankBin: null,
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
};

function toRow(s: PaymentSettingsRow): PaymentSettingsRow {
  return {
    acceptCash: s.acceptCash,
    acceptBankTransfer: s.acceptBankTransfer,
    cashInstructions: s.cashInstructions,
    bankBin: s.bankBin,
    bankName: s.bankName,
    bankAccountNo: s.bankAccountNo,
    bankAccountName: s.bankAccountName,
  };
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function getPaymentSettings(session: SessionContext): Promise<PaymentSettingsRow> {
  const row = await db.orgPaymentSettings.findUnique({
    where: { organizationId: session.organizationId },
  });
  return row ? toRow(row) : DEFAULTS;
}

// ── Upsert ───────────────────────────────────────────────────────────────────

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const upsertSchema = z
  .object({
    acceptCash: z.boolean(),
    acceptBankTransfer: z.boolean(),
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
    if (!v.acceptBankTransfer) return;
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
  const bank = input.bankBin ? findVnBank(input.bankBin) : null;
  const data = {
    acceptCash: input.acceptCash,
    acceptBankTransfer: input.acceptBankTransfer,
    cashInstructions: input.cashInstructions ?? null,
    bankBin: input.bankBin ?? null,
    bankName: bank?.name ?? null,
    bankAccountNo: input.bankAccountNo ?? null,
    bankAccountName: input.bankAccountName?.toUpperCase() ?? null,
  };
  const row = await db.orgPaymentSettings.upsert({
    where: { organizationId: session.organizationId }, // from session ONLY
    create: { organizationId: session.organizationId, ...data },
    update: data,
  });
  return toRow(row);
}
