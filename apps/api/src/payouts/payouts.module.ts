import { Module } from '@nestjs/common';

import { PayoutsAdminController } from './payouts.admin.controller.js';
import { PayoutsOwnerController } from './payouts.owner.controller.js';
import { PayoutsPartnerController } from './payouts.partner.controller.js';
import { PayoutsReleaseSweeper } from './payouts.release-sweeper.js';
import { PayoutsService } from './payouts.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { QueuesModule } from '../queues/queues.module.js';

@Module({
  imports: [AuditModule, PaymentsModule, QueuesModule],
  controllers: [PayoutsPartnerController, PayoutsOwnerController, PayoutsAdminController],
  providers: [PayoutsService, PayoutsReleaseSweeper],
  exports: [PayoutsService],
})
export class PayoutsModule {}
