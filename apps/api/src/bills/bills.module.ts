import { Module } from '@nestjs/common';

import { BillsOwnerController } from './bills.owner.controller.js';
import { BillsProcessor } from './bills.processor.js';
import { BillsReceiptService } from './bills.receipt.service.js';
import { BillsService } from './bills.service.js';
import { BillsSweepScheduler } from './bills.sweeper.js';
import { BillsTenantController } from './bills.tenant.controller.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { QueuesModule } from '../queues/queues.module.js';

@Module({
  imports: [QueuesModule, AuditModule],
  controllers: [BillsOwnerController, BillsTenantController],
  providers: [BillsService, BillsReceiptService, BillsProcessor, BillsSweepScheduler],
  exports: [BillsService],
})
export class BillsModule {}
