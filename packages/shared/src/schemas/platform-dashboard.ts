import { z } from 'zod';

import { currencySchema, isoDateTimeSchema } from './common';

export const moneyByCurrencySchema = z.object({
  currency: currencySchema,
  /** Minor units. */
  amount: z.number().int().nonnegative(),
});

export type MoneyByCurrency = z.infer<typeof moneyByCurrencySchema>;

/**
 * Single platform-wide snapshot read by the admin dashboard. No FX
 * conversion — totals are emitted per currency. See spec
 * `docs/specs/phase3-platform-dashboards.md`.
 */
export const platformDashboardSchema = z.object({
  users: z.object({
    /** Excludes soft-deleted. */
    total: z.number().int().nonnegative(),
    suspended: z.number().int().nonnegative(),
    pendingKyc: z.number().int().nonnegative(),
    /** `lastLoginAt >= now - 7d`. */
    activeIn7d: z.number().int().nonnegative(),
    activeIn30d: z.number().int().nonnegative(),
  }),
  houses: z.object({
    /** Excludes soft-deleted. */
    total: z.number().int().nonnegative(),
    published: z.number().int().nonnegative(),
    flagged: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  leases: z.object({
    active: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
  }),
  tickets: z.object({
    /** OPEN + ACKNOWLEDGED + IN_PROGRESS + REOPENED. */
    openCount: z.number().int().nonnegative(),
    resolvedLast7d: z.number().int().nonnegative(),
    /** Median ms between `createdAt` and `resolvedAt` over the trailing
     *  30 days of resolved tickets. `null` if zero resolved samples. */
    medianResolveMs: z.number().int().nullable(),
  }),
  /** Sum of `Bill.total` where `status === 'PAID'`, grouped by currency. */
  gmvAllTime: z.array(moneyByCurrencySchema),
  /** Same as gmvAllTime, restricted to bills with `updatedAt >= now - 30d`. */
  gmvLast30d: z.array(moneyByCurrencySchema),
  overdue: z.object({
    count: z.number().int().nonnegative(),
    byCurrency: z.array(moneyByCurrencySchema),
  }),
  generatedAt: isoDateTimeSchema,
});

export type PlatformDashboard = z.infer<typeof platformDashboardSchema>;
