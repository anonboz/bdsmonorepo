import { z } from 'zod';

import { currencySchema, idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

export const PayoutEntryKind = {
  CHARGE: 'CHARGE',
  COMMISSION: 'COMMISSION',
  PAYOUT: 'PAYOUT',
} as const;
export type PayoutEntryKind = (typeof PayoutEntryKind)[keyof typeof PayoutEntryKind];
export const payoutEntryKindSchema = z.nativeEnum(PayoutEntryKind);

export const PayoutEntryStatus = {
  PENDING: 'PENDING',
  HELD: 'HELD',
  RELEASED: 'RELEASED',
  /** Admin marked the row as actually paid out (Phase 7.6). Terminal. */
  DISBURSED: 'DISBURSED',
} as const;
export type PayoutEntryStatus = (typeof PayoutEntryStatus)[keyof typeof PayoutEntryStatus];
export const payoutEntryStatusSchema = z.nativeEnum(PayoutEntryStatus);

/**
 * How the platform moved the money out. Phase 7.6 ships only
 * `MANUAL_BANK_TRANSFER` — admin sent a bank wire and recorded the
 * reference. `STRIPE_CONNECT` is reserved for a future onboarding
 * flow and the API rejects it with 501 until then.
 */
export const PayoutDisbursementMethod = {
  MANUAL_BANK_TRANSFER: 'MANUAL_BANK_TRANSFER',
  STRIPE_CONNECT: 'STRIPE_CONNECT',
} as const;
export type PayoutDisbursementMethod =
  (typeof PayoutDisbursementMethod)[keyof typeof PayoutDisbursementMethod];
export const payoutDisbursementMethodSchema = z.nativeEnum(PayoutDisbursementMethod);

export const jobLedgerEntrySchema = z.object({
  id: idSchema,
  jobId: idSchema,
  kind: payoutEntryKindSchema,
  status: payoutEntryStatusSchema,
  /** Minor units, signed (negative for CHARGE, positive otherwise). */
  amount: z.number().int(),
  currency: currencySchema,
  accountUserId: idSchema.nullable(),
  cooldownUntil: isoDateTimeSchema.nullable(),
  releasedAt: isoDateTimeSchema.nullable(),
  /** Phase 7.6 — set when an admin marks the row DISBURSED. */
  disbursedAt: isoDateTimeSchema.nullable(),
  /** Bank ref / wire id / transfer id. Free-form, up to 200 chars. */
  disbursementRef: z.string().nullable(),
  disbursementMethod: payoutDisbursementMethodSchema.nullable(),
  /** Admin user id at disbursement time. */
  disbursedById: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export type JobLedgerEntry = z.infer<typeof jobLedgerEntrySchema>;

export const listLedgerEntriesQuerySchema = paginationQuerySchema.extend({
  status: payoutEntryStatusSchema.optional(),
});

export type ListLedgerEntriesQuery = z.infer<typeof listLedgerEntriesQuerySchema>;

// ---- Admin disbursement (Phase 7.6) ---------------------------------

/**
 * Request body for `POST /v1/admin/payouts/:id/disburse`. `reference`
 * is the bank-side transfer id / wire id; `note` is admin context kept
 * off the audit meta (same shape as `bill.payment.refund`).
 */
export const disbursePayoutSchema = z.object({
  method: payoutDisbursementMethodSchema,
  reference: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(500).optional(),
});

export type DisbursePayoutInput = z.infer<typeof disbursePayoutSchema>;

/**
 * Admin queue projection — extends the base entry with the partner's
 * display + business name so the page doesn't have to do per-row
 * lookups.
 */
export const adminPendingPayoutSchema = jobLedgerEntrySchema.extend({
  partnerUserId: idSchema,
  partnerName: z.string(),
  partnerBusinessName: z.string().nullable(),
});

export type AdminPendingPayout = z.infer<typeof adminPendingPayoutSchema>;
