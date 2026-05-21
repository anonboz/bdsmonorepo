import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { AdminPendingPayout, JobLedgerEntry, Page } from '@repo/shared';

import { DisbursePayoutDto, ListLedgerEntriesQueryDto } from './dto/payouts.dto.js';
import { PayoutsService } from './payouts.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

/**
 * Admin payout-disbursement queue. RELEASED rows show up here; the
 * dialog flips them to DISBURSED with a bank-transfer reference.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/payouts')
export class PayoutsAdminController {
  constructor(private readonly service: PayoutsService) {}

  @Get('pending')
  @Roles('ADMIN')
  pending(@Query() query: ListLedgerEntriesQueryDto): Promise<Page<AdminPendingPayout>> {
    return this.service.listAdminPending(query);
  }

  @Post(':id/disburse')
  @Roles('ADMIN')
  @HttpCode(200)
  disburse(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: DisbursePayoutDto,
  ): Promise<JobLedgerEntry> {
    return this.service.markDisbursed(id, body, requestContextFrom(user, req));
  }
}
