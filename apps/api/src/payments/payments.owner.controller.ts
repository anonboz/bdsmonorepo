import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Page, Payment, RecordPaymentResponse } from '@repo/shared';

import { RecordManualPaymentDto } from './dto/payments.dto.js';
import { PaymentsService } from './payments.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('houses/:houseId/units/:unitId/leases/:leaseId/bills/:billId/payments')
export class PaymentsOwnerController {
  constructor(private readonly service: PaymentsService) {}

  @Post()
  @Roles('OWNER')
  @HttpCode(201)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Param('billId') billId: string,
    @Body() body: RecordManualPaymentDto,
  ): Promise<RecordPaymentResponse> {
    return this.service.recordManualForOwner(
      user,
      houseId,
      unitId,
      leaseId,
      billId,
      body,
      requestContextFrom(user, req),
    );
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('leaseId') leaseId: string,
    @Param('billId') billId: string,
  ): Promise<Page<Payment>> {
    return this.service.listForOwnerBill(user, houseId, unitId, leaseId, billId);
  }
}
