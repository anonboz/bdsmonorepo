import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { applicationStatusSchema } from '../enums/misc';

export const applicationSchema = z.object({
  id: idSchema,
  campaignId: idSchema,
  ownerId: idSchema,
  applicantId: idSchema,
  /** Joined on read; current display name. */
  applicantName: z.string(),
  status: applicationStatusSchema,
  message: z.string().max(2000).nullable(),
  rejectionReason: z.string().max(500).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decidedBy: idSchema.nullable(),
  /** DRAFT lease created on accept; null otherwise. */
  createdLeaseId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type Application = z.infer<typeof applicationSchema>;

export const createApplicationSchema = z.object({
  campaignId: idSchema,
  message: z.string().trim().min(1).max(2000).optional(),
});

export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;

export const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;

export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  status: applicationStatusSchema.optional(),
});

export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
