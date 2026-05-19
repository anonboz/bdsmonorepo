import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import type { Bill, Page } from '@repo/shared';

import { BillsReceiptService } from './bills.receipt.service.js';
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
  constructor(
    private readonly bills: BillsService,
    private readonly receipts: BillsReceiptService,
  ) {}

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

  @Get(':id/receipt.pdf')
  @Roles('OWNER', 'ADMIN')
  async receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Auth check via the JSON read path (404s for non-owners; admins pass).
    await this.bills.getForLease(user, houseId, unitId, leaseId, id);
    const { buffer, filename } = await this.receipts.render(id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(buffer);
  }
}
