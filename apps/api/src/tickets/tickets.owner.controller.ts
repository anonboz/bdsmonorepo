import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Ticket, TicketMessage } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateTicketMessageDto, ListTicketMessagesQueryDto } from './dto/ticket-messages.dto.js';
import { ListTicketsQueryDto, TransitionTicketDto } from './dto/tickets.dto.js';
import { TicketMessagesService } from './ticket-messages.service.js';
import { TicketsService } from './tickets.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('me/owner-tickets')
export class TicketsOwnerController {
  constructor(
    private readonly service: TicketsService,
    private readonly messages: TicketMessagesService,
  ) {}

  @Get()
  @Roles('OWNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ): Promise<Page<Ticket>> {
    return this.service.listForOwner(user.id, query);
  }

  @Get(':id')
  @Roles('OWNER')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Ticket> {
    return this.service.getForOwner(user.id, id);
  }

  @Post(':id/transitions')
  @Roles('OWNER')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: TransitionTicketDto,
  ): Promise<Ticket> {
    return this.service.ownerTransition(user.id, id, body);
  }

  @Get(':id/messages')
  @Roles('OWNER')
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    return this.messages.listForOwner(user.id, id, query);
  }

  @Post(':id/messages')
  @Roles('OWNER')
  postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CreateTicketMessageDto,
  ): Promise<TicketMessage> {
    return this.messages.postForOwner(user.id, user.displayName, id, body);
  }
}
