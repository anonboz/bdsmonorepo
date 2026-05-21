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
  /** Minor units; always positive. Refunds (Phase 7.5) are separate
   *  Payment rows with negative amounts. */
  amount: z.number().int().positive(),
  currency: currencySchema,
  status: paymentStatusSchema,
  provider: paymentProviderSchema,
  /** Bank ref, Stripe payment intent id, VNPay txn ref. Null for
   *  unattributed offline payments. */
  providerRef: z.string().nullable(),
  /** Owner's free-form context — kept out of audit meta. */
  note: z.string().max(500).nullable(),
  /** When the money actually moved. Distinct from `createdAt` (when
   *  this row was inserted). */
  receivedAt: isoDateTimeSchema.nullable(),
  failureReason: z.string().nullable(),
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
