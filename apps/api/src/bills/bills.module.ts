import { Module } from '@nestjs/common';

import { BillsOwnerController } from './bills.owner.controller.js';
import { BillsProcessor } from './bills.processor.js';
import { BillsService } from './bills.service.js';
import { BillsSweepScheduler } from './bills.sweeper.js';
import { BillsTenantController } from './bills.tenant.controller.js';
import { QueuesModule } from '../queues/queues.module.js';

@Module({
  imports: [QueuesModule],
  controllers: [BillsOwnerController, BillsTenantController],
  providers: [BillsService, BillsProcessor, BillsSweepScheduler],
  exports: [BillsService],
})
export class BillsModule {}
