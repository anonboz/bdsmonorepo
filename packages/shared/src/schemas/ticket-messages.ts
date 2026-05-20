import { z } from 'zod';

import { idSchema, isoDateTimeSchema, paginationQuerySchema } from './common';

/**
 * Frozen role at write time. We store the author's then-current role on the
 * row so a later role change does not retroactively re-attribute the message.
 * Admin can read threads but never write — so this is intentionally narrow.
 */
export const ticketMessageAuthorRoleSchema = z.enum(['TENANT', 'OWNER', 'ADMIN']);
export type TicketMessageAuthorRole = z.infer<typeof ticketMessageAuthorRoleSchema>;

export const ticketMessageSchema = z.object({
  id: idSchema,
  ticketId: idSchema,
  authorId: idSchema,
  /** Joined on read; current display name. */
  authorName: z.string(),
  authorRole: ticketMessageAuthorRoleSchema,
  body: z.string().min(1).max(4000),
  createdAt: isoDateTimeSchema,
});

export type TicketMessage = z.infer<typeof ticketMessageSchema>;

export const createTicketMessageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export type CreateTicketMessageInput = z.infer<typeof createTicketMessageSchema>;

/**
 * Thread reads default to ascending (oldest first) so the UI does not have to
 * reverse client-side. Other domains default to `desc`; we override here.
 */
export const listTicketMessagesQuerySchema = paginationQuerySchema.extend({
  sort: z.enum(['asc', 'desc']).default('asc'),
});

export type ListTicketMessagesQuery = z.infer<typeof listTicketMessagesQuerySchema>;
