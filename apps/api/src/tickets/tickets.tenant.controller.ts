import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Ticket, TicketMessage } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateTicketMessageDto, ListTicketMessagesQueryDto } from './dto/ticket-messages.dto.js';
import { CreateTicketDto, ListTicketsQueryDto, TransitionTicketDto } from './dto/tickets.dto.js';
import { TicketMessagesService } from './ticket-messages.service.js';
import { TicketsService } from './tickets.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('me/tickets')
export class TicketsTenantController {
  constructor(
    private readonly service: TicketsService,
    private readonly messages: TicketMessagesService,
  ) {}

  @Post()
  @Roles('TENANT')
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateTicketDto): Promise<Ticket> {
    return this.service.createForTenant(user.id, body);
  }

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTicketsQueryDto,
  ): Promise<Page<Ticket>> {
    return this.service.listForTenant(user.id, query);
  }

  @Get(':id')
  @Roles('TENANT')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Ticket> {
    return this.service.getForTenant(user.id, id);
  }

  @Post(':id/transitions')
  @Roles('TENANT')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() _body: TransitionTicketDto,
  ): Promise<Ticket> {
    // Tenant transitions are reopen-only; service enforces and ignores
    // the body payload beyond shape validation done by the Zod pipe.
    return this.service.tenantReopen(user.id, id);
  }

  @Get(':id/messages')
  @Roles('TENANT')
  listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ListTicketMessagesQueryDto,
  ): Promise<Page<TicketMessage>> {
    return this.messages.listForTenant(user.id, id, query);
  }

  @Post(':id/messages')
  @Roles('TENANT')
  postMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: CreateTicketMessageDto,
  ): Promise<TicketMessage> {
    return this.messages.postForTenant(user.id, user.displayName, id, body);
  }
}
