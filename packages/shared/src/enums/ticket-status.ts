import { z } from 'zod';

export const TicketStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  REOPENED: 'REOPENED',
} as const;

export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

export const ticketStatusSchema = z.nativeEnum(TicketStatus);

export const TicketCategory = {
  REPAIR: 'REPAIR',
  REPORT: 'REPORT',
  COMPLAINT: 'COMPLAINT',
  REQUEST: 'REQUEST',
  OTHER: 'OTHER',
} as const;

export type TicketCategory = (typeof TicketCategory)[keyof typeof TicketCategory];

export const ticketCategorySchema = z.nativeEnum(TicketCategory);
