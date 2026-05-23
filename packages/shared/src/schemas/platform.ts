import { z } from 'zod';

import { isoDateTimeSchema } from './common';

/**
 * Phase 9.6: platform-wide config singleton (commission rate today,
 * room for payout cooldown / currency defaults later).
 */
export const platformConfigSchema = z.object({
  /** Commission rate in basis points. 1000 = 10%. */
  commissionBps: z.number().int().min(0).max(5000),
  /** Phase 10.6 — days between a user's erasure request and the
   *  sweeper executing. Range cap at 90 keeps a typo from parking
   *  accounts indefinitely. */
  accountErasureGraceDays: z.number().int().min(0).max(90),
  updatedAt: isoDateTimeSchema,
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const updatePlatformConfigSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000).optional(),
  accountErasureGraceDays: z.number().int().min(0).max(90).optional(),
});
export type UpdatePlatformConfigInput = z.infer<typeof updatePlatformConfigSchema>;
