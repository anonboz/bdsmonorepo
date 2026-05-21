import { z } from 'zod';

import { billSchema } from './bills';
import { currencySchema, idSchema, isoDateTimeSchema } from './common';
import { paymentProviderSchema, paymentStatusSchema } from '../enums/misc';

/**
 * A single `Payment` row. One Bill can have many Payments — partial
 * payments accumulate, the Bill's status is derived from the
 * succeeded sum vs `bill.total`.
 */
export const paymentSchema = z.object({
  id: idSchema,
  billId: idSchema,
  /** Minor units. Signed: charges are positive, refunds are negative
   *  and link back via `refundOfPaymentId`. */
  amount: z.number().int(),
  currency: currencySchema,
  status: paymentStatusSchema,
  provider: paymentProviderSchema,
  /** Session / checkout / IPN-time reference (Stripe session id,
   *  VNPay TxnRef, MANUAL bank reference). */
  providerRef: z.string().nullable(),
  /** Settled-transaction reference (Stripe PaymentIntent id, VNPay
   *  `vnp_TransactionNo`). Populated by webhooks; required to issue
   *  a refund via the provider API. */
  providerCaptureRef: z.string().nullable(),
  /** Owner's free-form context — kept out of audit meta. */
  note: z.string().max(500).nullable(),
  /** When the money actually moved. Distinct from `createdAt` (when
   *  this row was inserted). */
  receivedAt: isoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
  /** Original Payment id this row reverses. NULL on regular charges. */
  refundOfPaymentId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type Payment = z.infer<typeof paymentSchema>;

/**
 * Body for the owner's "Record manual payment" form. Provider is
 * forced to `MANUAL` on the server; the field isn't in the request.
 */
export const recordManualPaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: currencySchema,
  /** Bank ref, cheque number, transfer id — free-form, optional. */
  providerRef: z.string().trim().min(1).max(120).optional(),
  /** Owner's note for the audit trail / future-self. */
  note: z.string().trim().min(1).max(500).optional(),
  /** ISO datetime; server defaults to now() when omitted. The service
   *  rejects timestamps more than one day in the future. */
  receivedAt: isoDateTimeSchema.optional(),
});

export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

/**
 * POST response: the new Payment plus the updated Bill so the client
 * can render the new status without a follow-up GET.
 */
export const recordPaymentResponseSchema = z.object({
  payment: paymentSchema,
  bill: billSchema,
});

export type RecordPaymentResponse = z.infer<typeof recordPaymentResponseSchema>;

/**
 * Response shape for `POST /v1/me/bills/:id/checkout` — the client
 * redirects to `url` to hit the hosted Stripe Checkout page. The
 * `paymentId` is the local PENDING row created at session time; the
 * webhook (Phase 7.3) flips it to `SUCCEEDED` and the bill to PAID.
 */
export const createCheckoutSessionResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string().min(1),
  paymentId: idSchema,
});

export type CreateCheckoutSessionResponse = z.infer<typeof createCheckoutSessionResponseSchema>;

/**
 * Body for the owner's refund action on a SUCCEEDED Payment row.
 * Always positive — the service negates the amount before insert.
 * `reason` is owner-only context kept off the audit meta (same
 * pattern as `note` on the manual-record path).
 */
export const refundPaymentSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
