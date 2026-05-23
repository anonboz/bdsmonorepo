import { z } from 'zod';

import { isoDateTimeSchema } from './common';

/**
 * Phase 9.6: platform-wide config singleton (commission rate today,
 * room for payout cooldown / currency defaults later).
 */
export const platformConfigSchema = z.object({
  /** Commission rate in basis points. 1000 = 10%. */
  commissionBps: z.number().int().min(0).max(5000),
  updatedAt: isoDateTimeSchema,
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const updatePlatformConfigSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000),
});
export type UpdatePlatformConfigInput = z.infer<typeof updatePlatformConfigSchema>;
