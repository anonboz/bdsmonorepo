import { z } from 'zod';

import {
  emailSchema,
  idSchema,
  isoDateTimeSchema,
  paginationQuerySchema,
  phoneSchema,
} from './common';
import { campaignStatusSchema, houseModerationStatusSchema, kycStatusSchema } from '../enums/misc';
import { roleSchema } from '../enums/role';

export const adminUserSchema = z.object({
  id: idSchema,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  displayName: z.string(),
  roles: z.array(roleSchema),
  kycStatus: kycStatusSchema,
  isSuspended: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const listAdminUsersQuerySchema = paginationQuerySchema.extend({
  /** Substring match against email and displayName. */
  q: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  kycStatus: kycStatusSchema.optional(),
  isSuspended: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
});

export type ListAdminUsersQuery = z.infer<typeof listAdminUsersQuerySchema>;

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;

export const unsuspendUserSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type UnsuspendUserInput = z.infer<typeof unsuspendUserSchema>;

export const kycDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVED') }),
  z.object({
    decision: z.literal('REJECTED'),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({ decision: z.literal('PENDING') }),
  z.object({ decision: z.literal('NONE') }),
]);

export type KycDecisionInput = z.infer<typeof kycDecisionSchema>;

export const auditLogEntrySchema = z.object({
  id: idSchema,
  actorId: idSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const listAuditLogQuerySchema = paginationQuerySchema.extend({
  actorId: idSchema.optional(),
  /** Prefix match — e.g. `user.` to get all user-related entries. */
  action: z.string().max(100).optional(),
  /** Exact match, e.g. `User:abc123`. */
  target: z.string().max(120).optional(),
});

export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

// ---- House moderation -------------------------------------------------

export const listAdminHousesQuerySchema = paginationQuerySchema.extend({
  /** Substring match against name and city. */
  q: z.string().trim().max(100).optional(),
  ownerId: idSchema.optional(),
  moderationStatus: houseModerationStatusSchema.optional(),
});

export type ListAdminHousesQuery = z.infer<typeof listAdminHousesQuerySchema>;

export const flagHouseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type FlagHouseInput = z.infer<typeof flagHouseSchema>;

export const clearHouseModerationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type ClearHouseModerationInput = z.infer<typeof clearHouseModerationSchema>;

export const rejectHouseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectHouseInput = z.infer<typeof rejectHouseSchema>;

// ---- Campaign moderation ---------------------------------------------

export const listAdminCampaignsQuerySchema = paginationQuerySchema.extend({
  /** Substring match against title and unit city. */
  q: z.string().trim().max(100).optional(),
  ownerId: idSchema.optional(),
  status: campaignStatusSchema.optional(),
});

export type ListAdminCampaignsQuery = z.infer<typeof listAdminCampaignsQuerySchema>;

export const approveCampaignSchema = z.object({}).strict();
export type ApproveCampaignInput = z.infer<typeof approveCampaignSchema>;

export const rejectCampaignSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectCampaignInput = z.infer<typeof rejectCampaignSchema>;

// ---- Operational metrics (Phase 6.4) --------------------------------

export const queueDepthSchema = z.object({
  name: z.string(),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});
export type QueueDepth = z.infer<typeof queueDepthSchema>;

export const metricsResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  queues: z.array(queueDepthSchema),
  redis: z.object({
    connected: z.boolean(),
    /** Round-trip ms for the most recent PING. Null if not connected. */
    pingMs: z.number().nullable(),
  }),
  sentry: z.object({
    /** True iff `SENTRY_DSN` was set at boot. */
    enabled: z.boolean(),
    /** `env.NODE_ENV` at boot; null when Sentry isn't initialized. */
    environment: z.string().nullable(),
  }),
});
export type MetricsResponse = z.infer<typeof metricsResponseSchema>;
