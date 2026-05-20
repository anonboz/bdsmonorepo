import { z } from 'zod';

import { currencySchema, idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { jobStatusSchema } from '../enums/job-status';

export const serviceJobSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  partnerId: idSchema,
  /** Joined on read; partner's `businessName`. */
  partnerBusinessName: z.string(),
  serviceId: idSchema.nullable(),
  /** Joined on read; null if no service is linked or it was deleted. */
  serviceName: z.string().nullable(),
  ticketId: idSchema.nullable(),
  unitId: idSchema.nullable(),
  status: jobStatusSchema,
  description: z.string().max(2000).nullable(),
  /** Minor units. Set on quote. */
  quotedAmount: z.number().int().nonnegative().nullable(),
  /** Minor units. Defaults to quotedAmount on complete. */
  finalAmount: z.number().int().nonnegative().nullable(),
  currency: currencySchema.nullable(),
  scheduledFor: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().max(200).nullable(),
  cancelledBy: idSchema.nullable(),
  proofPhotos: z.array(z.string().url()).max(20),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type ServiceJob = z.infer<typeof serviceJobSchema>;

export const createServiceJobSchema = z.object({
  partnerId: idSchema,
  serviceId: idSchema.optional(),
  unitId: idSchema.optional(),
  /**
   * Set to route the job through a ticket (Phase 5.3). The service
   * derives `unitId` from the ticket's lease, so any client-supplied
   * `unitId` is ignored when this is present.
   */
  ticketId: idSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  scheduledFor: isoDateTimeSchema.optional(),
});

export type CreateServiceJobInput = z.infer<typeof createServiceJobSchema>;

export const quoteServiceJobSchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: currencySchema,
});

export type QuoteServiceJobInput = z.infer<typeof quoteServiceJobSchema>;

export const completeServiceJobSchema = z.object({
  /** Defaults to `quotedAmount` if omitted. */
  finalAmount: z.number().int().nonnegative().optional(),
  proofPhotos: z.array(z.string().url()).max(20).optional(),
});

export type CompleteServiceJobInput = z.infer<typeof completeServiceJobSchema>;

export const cancelServiceJobSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export type CancelServiceJobInput = z.infer<typeof cancelServiceJobSchema>;

export const listServiceJobsQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
  /** Filter to jobs linked to a specific ticket. */
  ticketId: idSchema.optional(),
});

export type ListServiceJobsQuery = z.infer<typeof listServiceJobsQuerySchema>;
