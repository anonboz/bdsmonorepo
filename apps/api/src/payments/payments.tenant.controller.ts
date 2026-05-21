import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { CreateCheckoutSessionResponse, Page, Payment } from '@repo/shared';

import { PaymentsService } from './payments.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('me/bills/:billId')
export class PaymentsTenantController {
  constructor(private readonly service: PaymentsService) {}

  @Get('payments')
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('billId') billId: string,
  ): Promise<Page<Payment>> {
    return this.service.listForTenantBill(user.id, billId);
  }

  @Post('checkout')
  @Roles('TENANT')
  @HttpCode(201)
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('billId') billId: string,
  ): Promise<CreateCheckoutSessionResponse> {
    return this.service.createStripeCheckoutForTenant(
      user.id,
      user.email,
      billId,
      requestContextFrom(user, req),
    );
  }
}
