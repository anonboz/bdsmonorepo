import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Bill, Page } from '@repo/shared';

import { BillsService } from './bills.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { GenerateBillDto, ListBillsQueryDto } from './dto/bills.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Owner-scoped bills routes. "Generate now" runs the generator
 * synchronously rather than enqueueing — same code path, instant feedback
 * for the owner clicking the button. The recurring daily-sweep + worker
 * handle the auto-generation case.
 */
@ApiTags('bills')
@ApiBearerAuth()
@Controller('houses/:houseId/units/:unitId/leases/:leaseId/bills')
export class BillsOwnerController {
  constructor(private readonly bills: BillsService) {}

  @Post('generate-now')
  @Roles('OWNER')
  @HttpCode(201)
  async generateNow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Body() body: GenerateBillDto,
  ): Promise<{ bill: Bill; status: 'created' | 'idempotent' }> {
    // assertOwner-of-lease via list call's auth (cheap) — service throws
    // 404 otherwise.
    await this.bills.listForLease(user, houseId, unitId, leaseId, { limit: 1, sort: 'desc' });
    return this.bills.generateForLease(leaseId, body);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Query() query: ListBillsQueryDto,
  ): Promise<Page<Bill>> {
    return this.bills.listForLease(user, houseId, unitId, leaseId, query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Param('id') id: string,
  ): Promise<Bill> {
    return this.bills.getForLease(user, houseId, unitId, leaseId, id);
  }
}
