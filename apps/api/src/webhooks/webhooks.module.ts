import { Module } from '@nestjs/common';

import { WebhooksService } from './webhooks.service.js';
import { WebhooksStripeController } from './webhooks.stripe.controller.js';
import { WebhooksVnpayController } from './webhooks.vnpay.controller.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [AuditModule, PaymentsModule],
  controllers: [WebhooksStripeController, WebhooksVnpayController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
