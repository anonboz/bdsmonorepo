import { Module } from '@nestjs/common';

import { PaymentsOwnerController } from './payments.owner.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsTenantController } from './payments.tenant.controller.js';
import { StripeService } from './stripe.service.js';
import { VnpayService } from './vnpay.service.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [PaymentsOwnerController, PaymentsTenantController],
  providers: [PaymentsService, StripeService, VnpayService],
  exports: [PaymentsService, StripeService, VnpayService],
})
export class PaymentsModule {}
