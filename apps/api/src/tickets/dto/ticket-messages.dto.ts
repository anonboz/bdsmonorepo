import {
  createTicketMessageSchema,
  listTicketMessagesQuerySchema,
  type ticketMessageSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateTicketMessageDto = createZodDto(createTicketMessageSchema);
export type CreateTicketMessageDto = typeof createTicketMessageSchema._type;

export const ListTicketMessagesQueryDto = createZodDto(listTicketMessagesQuerySchema);
export type ListTicketMessagesQueryDto = typeof listTicketMessagesQuerySchema._type;

export type TicketMessageResponse = typeof ticketMessageSchema._type;
