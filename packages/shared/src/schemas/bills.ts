import { z } from 'zod';

import {
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
} from './common';
import { billStatusSchema } from '../enums/bill-status';
import { billLineKindSchema } from '../enums/misc';

export const billLineSchema = z.object({
  id: idSchema,
  billId: idSchema,
  kind: billLineKindSchema,
  label: z.string().min(1).max(200),
  /** Minor units. Can be negative for credits / adjustments. */
  amount: z.number().int(),
  quantity: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
});

export type BillLine = z.infer<typeof billLineSchema>;

export const billSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  dueDate: isoDateSchema,
  issuedAt: isoDateTimeSchema.nullable(),
  status: billStatusSchema,
  subtotal: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currency: currencySchema,
  lines: z.array(billLineSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type Bill = z.infer<typeof billSchema>;

/**
 * Manual "generate now" body. `periodStart` is optional — defaults to the
 * start of the lease's current period on the API side.
 */
export const generateBillSchema = z.object({
  periodStart: isoDateSchema.optional(),
});

export type GenerateBillInput = z.infer<typeof generateBillSchema>;

export const listBillsQuerySchema = paginationQuerySchema.extend({
  status: billStatusSchema.optional(),
});

export type ListBillsQuery = z.infer<typeof listBillsQuerySchema>;
