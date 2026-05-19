import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Bill, Page } from '@repo/shared';

import { BillsService } from './bills.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ListBillsQueryDto } from './dto/bills.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('bills')
@ApiBearerAuth()
@Controller('me/bills')
export class BillsTenantController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListBillsQueryDto,
  ): Promise<Page<Bill>> {
    return this.bills.listForTenant(user.id, query);
  }

  @Get(':id')
  @Roles('TENANT')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Bill> {
    return this.bills.getForTenant(user.id, id);
  }
}
