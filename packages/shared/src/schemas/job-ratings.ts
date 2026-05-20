import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';
import { jobRatingDirectionSchema } from '../enums/misc';

export const jobRatingSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  raterId: idSchema,
  /** Joined from the User row on read; current display name. */
  raterName: z.string(),
  ratedId: idSchema,
  ratedName: z.string(),
  direction: jobRatingDirectionSchema,
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
});

export type JobRating = z.infer<typeof jobRatingSchema>;

export const createJobRatingSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().trim().min(1).max(2000).optional(),
});

export type CreateJobRatingInput = z.infer<typeof createJobRatingSchema>;

/**
 * Both directions for a single job. Each side is `null` until that
 * party submits its rating.
 */
export const jobRatingsForJobSchema = z.object({
  jobId: idSchema,
  ownerToPartner: jobRatingSchema.nullable(),
  partnerToOwner: jobRatingSchema.nullable(),
});

export type JobRatingsForJob = z.infer<typeof jobRatingsForJobSchema>;
