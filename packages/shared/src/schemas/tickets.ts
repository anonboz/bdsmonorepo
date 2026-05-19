import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';
import { ticketCategorySchema, ticketStatusSchema } from '../enums/ticket-status';

export const ticketSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  /** Denormalized for UI breadcrumbs and queue rendering. */
  unitId: idSchema,
  houseId: idSchema,
  reporterId: idSchema,
  reporterName: z.string(),
  assigneeId: idSchema.nullable(),
  category: ticketCategorySchema,
  status: ticketStatusSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  resolvedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export type Ticket = z.infer<typeof ticketSchema>;

export const createTicketSchema = z.object({
  leaseId: idSchema,
  category: ticketCategorySchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;

/**
 * Discriminated by `to`. Tenant can only `REOPENED` (within the reopen
 * window — enforced server-side, not in the schema). Other transitions
 * are owner-only — enforced by the service.
 */
export const transitionTicketSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('ACKNOWLEDGED') }),
  z.object({ to: z.literal('IN_PROGRESS') }),
  z.object({ to: z.literal('RESOLVED') }),
  z.object({ to: z.literal('CLOSED') }),
  z.object({
    to: z.literal('REOPENED'),
    reason: z.string().min(1).max(2000).optional(),
  }),
]);

export type TransitionTicketInput = z.infer<typeof transitionTicketSchema>;

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: ticketStatusSchema.optional(),
  category: ticketCategorySchema.optional(),
});

export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
