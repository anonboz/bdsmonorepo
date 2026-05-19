import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Ticket } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ListTicketsQueryDto, TransitionTicketDto } from './dto/tickets.dto.js';
import { TicketsService } from './tickets.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('me/owner-tickets')
export class TicketsOwnerController {
  constructor(private readonly service: TicketsService) {}

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
}
