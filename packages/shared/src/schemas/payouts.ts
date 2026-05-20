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
} as const;
export type PayoutEntryStatus = (typeof PayoutEntryStatus)[keyof typeof PayoutEntryStatus];
export const payoutEntryStatusSchema = z.nativeEnum(PayoutEntryStatus);

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
  createdAt: isoDateTimeSchema,
});

export type JobLedgerEntry = z.infer<typeof jobLedgerEntrySchema>;

export const listLedgerEntriesQuerySchema = paginationQuerySchema.extend({
  status: payoutEntryStatusSchema.optional(),
});

export type ListLedgerEntriesQuery = z.infer<typeof listLedgerEntriesQuerySchema>;
