import { Module } from '@nestjs/common';

import { PayoutsOwnerController } from './payouts.owner.controller.js';
import { PayoutsPartnerController } from './payouts.partner.controller.js';
import { PayoutsReleaseSweeper } from './payouts.release-sweeper.js';
import { PayoutsService } from './payouts.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { QueuesModule } from '../queues/queues.module.js';

@Module({
  imports: [AuditModule, QueuesModule],
  controllers: [PayoutsPartnerController, PayoutsOwnerController],
  providers: [PayoutsService, PayoutsReleaseSweeper],
  exports: [PayoutsService],
})
export class PayoutsModule {}
