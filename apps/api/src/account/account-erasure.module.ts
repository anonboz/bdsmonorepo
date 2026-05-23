import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AccountErasureController } from './account-erasure.controller.js';
import { AccountErasureService } from './account-erasure.service.js';
import { AccountErasureSweeper } from './account-erasure.sweeper.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { env } from '../env.js';
import { QUEUE_ACCOUNT_ERASURE_SWEEP } from '../queues/queue-names.js';

@Module({
  imports: [
    AdminModule,
    AuditModule,
    BullModule.registerQueue({ name: QUEUE_ACCOUNT_ERASURE_SWEEP }),
  ],
  controllers: [AccountErasureController],
  providers: [AccountErasureService, ...(env.API_DISABLE_QUEUES ? [] : [AccountErasureSweeper])],
})
export class AccountErasureModule {}
