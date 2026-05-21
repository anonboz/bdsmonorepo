import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Payment } from '@repo/shared';

import { PaymentsService } from './payments.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('me/bills/:billId/payments')
export class PaymentsTenantController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('billId') billId: string,
  ): Promise<Page<Payment>> {
    return this.service.listForTenantBill(user.id, billId);
  }
}
