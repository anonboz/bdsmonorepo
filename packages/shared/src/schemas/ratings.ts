import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { ratingDirectionSchema, ratingMilestoneSchema } from '../enums/misc';

export const leaseRatingSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  raterId: idSchema,
  /** Joined on read; current display name. */
  raterName: z.string(),
  ratedId: idSchema,
  ratedName: z.string(),
  direction: ratingDirectionSchema,
  milestone: ratingMilestoneSchema,
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
});

export type LeaseRating = z.infer<typeof leaseRatingSchema>;

export const createLeaseRatingSchema = z.object({
  milestone: ratingMilestoneSchema,
  score: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(2000).optional(),
});

export type CreateLeaseRatingInput = z.infer<typeof createLeaseRatingSchema>;

/**
 * One row per milestone. The UI uses `isOpen` to decide whether to render the
 * submit form, and `alreadyRated` to swap it for a "thanks, rated N stars"
 * confirmation. `reason` carries a stable code (e.g. `LEASE_DRAFT`,
 * `BEFORE_OPENS_AT`) when `isOpen` is false so the client can localize.
 */
export const ratingMilestoneStateSchema = z.object({
  milestone: ratingMilestoneSchema,
  opensAt: isoDateTimeSchema.nullable(),
  isOpen: z.boolean(),
  reason: z.string().nullable(),
  alreadyRated: z.boolean(),
});

export type RatingMilestoneState = z.infer<typeof ratingMilestoneStateSchema>;

export const leaseRatingStateSchema = z.object({
  leaseId: idSchema,
  direction: ratingDirectionSchema,
  milestones: z.array(ratingMilestoneStateSchema),
});

export type LeaseRatingState = z.infer<typeof leaseRatingStateSchema>;

export const userRatingSummarySchema = z.object({
  userId: idSchema,
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
});

export type UserRatingSummary = z.infer<typeof userRatingSummarySchema>;

export const listLeaseRatingsQuerySchema = paginationQuerySchema;
export type ListLeaseRatingsQuery = z.infer<typeof listLeaseRatingsQuerySchema>;
