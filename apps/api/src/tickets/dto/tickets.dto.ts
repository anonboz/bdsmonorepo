import {
  createTicketSchema,
  listTicketsQuerySchema,
  type ticketSchema,
  transitionTicketSchema,
} from '@repo/shared';

import { createZodDto } from '../../common/dto/zod-dto.js';

export const CreateTicketDto = createZodDto(createTicketSchema);
export type CreateTicketDto = typeof createTicketSchema._type;

export const TransitionTicketDto = createZodDto(transitionTicketSchema);
export type TransitionTicketDto = typeof transitionTicketSchema._type;

export const ListTicketsQueryDto = createZodDto(listTicketsQuerySchema);
export type ListTicketsQueryDto = typeof listTicketsQuerySchema._type;

export type TicketResponse = typeof ticketSchema._type;
