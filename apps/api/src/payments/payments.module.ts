import { Module } from '@nestjs/common';

import { PaymentsOwnerController } from './payments.owner.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentsTenantController } from './payments.tenant.controller.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [PaymentsOwnerController, PaymentsTenantController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
