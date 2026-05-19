import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import type { Bill, Page } from '@repo/shared';

import { BillsReceiptService } from './bills.receipt.service.js';
import { BillsService } from './bills.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ListBillsQueryDto } from './dto/bills.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('bills')
@ApiBearerAuth()
@Controller('me/bills')
export class BillsTenantController {
  constructor(
    private readonly bills: BillsService,
    private readonly receipts: BillsReceiptService,
  ) {}

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

  @Get(':id/receipt.pdf')
  @Roles('TENANT')
  async receipt(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // Auth check: 404s if not this tenant's bill.
    await this.bills.getForTenant(user.id, id);
    const { buffer, filename } = await this.receipts.render(id);
    void reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .header('cache-control', 'private, no-store')
      .send(buffer);
  }
}
