import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Ticket } from '@repo/shared';

import { ListTicketsQueryDto } from './dto/tickets.dto.js';
import { TicketsService } from './tickets.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
export class TicketsAdminController {
  constructor(private readonly service: TicketsService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListTicketsQueryDto): Promise<Page<Ticket>> {
    return this.service.listAll(query);
  }

  @Get(':id')
  @Roles('ADMIN')
  getOne(@Param('id') id: string): Promise<Ticket> {
    return this.service.getAny(id);
  }
}
