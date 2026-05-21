import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { QUEUE_BILLS_GENERATE } from '../queues/queue-names.js';

@Module({
  // Re-register the bills queue (no-op on the producer side since
  // QueuesModule already does it globally) to expose its connection
  // for Redis pings — re-registration is the documented way to grab
  // an InjectQueue token without depending on QueuesModule's export
  // graph in the right order.
  imports: [BullModule.registerQueue({ name: QUEUE_BILLS_GENERATE })],
  controllers: [HealthController],
})
export class HealthModule {}
