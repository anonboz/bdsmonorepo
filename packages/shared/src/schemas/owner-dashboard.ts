import { z } from 'zod';

import { currencySchema, idSchema, isoDateSchema, isoDateTimeSchema } from './common';
import { billStatusSchema } from '../enums/bill-status';

/**
 * Slim bill projection for dashboard tables. Mirrors fields the UI needs
 * to render a row and link to the detail page — no lines, no joined
 * unit row beyond a label/address string.
 */
export const billDashboardItemSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  unitId: idSchema,
  houseId: idSchema,
  unitLabel: z.string(),
  houseName: z.string(),
  tenantName: z.string(),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  dueDate: isoDateSchema,
  status: billStatusSchema,
  total: z.number().int().nonnegative(),
  currency: currencySchema,
  createdAt: isoDateTimeSchema,
});

export type BillDashboardItem = z.infer<typeof billDashboardItemSchema>;

export const ownerDashboardSchema = z.object({
  occupancy: z.object({
    occupied: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** 0–1, rounded to 4 decimals. UI multiplies by 100 for display. */
    rate: z.number().min(0).max(1),
  }),
  /**
   * MRR per currency. Each ACTIVE lease's rentAmount is normalized to a
   * monthly equivalent (WEEKLY × 4.333, QUARTERLY ÷ 3, YEARLY ÷ 12) then
   * summed within currency. No FX conversion in this slice.
   */
  mrr: z.array(
    z.object({
      currency: currencySchema,
      /** Minor units. */
      amount: z.number().int().nonnegative(),
    }),
  ),
  counts: z.object({
    houses: z.number().int().nonnegative(),
    units: z.number().int().nonnegative(),
    activeLeases: z.number().int().nonnegative(),
    /** DISTINCT tenant ids across the owner's active leases. */
    tenants: z.number().int().nonnegative(),
    overdueBills: z.number().int().nonnegative(),
  }),
  overdueBills: z.array(billDashboardItemSchema),
  recentBills: z.array(billDashboardItemSchema),
});

export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
