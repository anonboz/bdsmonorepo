import { z } from 'zod';

import { currencySchema, idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { campaignStatusSchema } from '../enums/misc';

export const campaignSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  unitId: idSchema,
  /** Denormalized for owner-side breadcrumbs + filters. */
  houseId: idSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  /** Minor units. */
  price: z.number().int().nonnegative(),
  currency: currencySchema,
  photos: z.array(z.string().url()).max(20),
  status: campaignStatusSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  moderationReason: z.string().max(500).nullable(),
  moderationDecidedAt: isoDateTimeSchema.nullable(),
  moderationDecidedBy: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export type Campaign = z.infer<typeof campaignSchema>;

export const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  price: z.number().int().nonnegative(),
  currency: currencySchema,
  photos: z.array(z.string().url()).max(20).default([]),
  expiresAt: isoDateTimeSchema.optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = createCampaignSchema.partial();
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

/**
 * Owner-side transitions only. Admin transitions (PENDING → LIVE /
 * REJECTED) ship in 4.2 with their own schema so the role gate is
 * trivial — owners can never reach the admin verbs and vice versa.
 */
export const transitionCampaignSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('PENDING') }), // DRAFT → PENDING (submit)
  z.object({ to: z.literal('DRAFT') }), // PENDING → DRAFT (withdraw)
  z.object({ to: z.literal('CLOSED') }), // LIVE → CLOSED  (close)
]);

export type TransitionCampaignInput = z.infer<typeof transitionCampaignSchema>;

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusSchema.optional(),
});

export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;
