import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { env } from '../env.js';
import { QUEUE_BILLS_GENERATE, QUEUE_BILLS_SWEEP } from './queue-names.js';

/**
 * Single shared Redis connection for all BullMQ queues. ioredis auto-handles
 * `rediss://` TLS — no extra options needed for Upstash. We expose the
 * config object (not an ioredis instance) so BullMQ can spin up its own
 * connection pools per queue + worker, which is what bullmq expects.
 *
 * When API_DISABLE_QUEUES=true (e.g. in unit tests) the module still
 * registers but every queue is configured with an unreachable URL — the
 * code paths that enqueue won't fire under that env.
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: env.REDIS_URL,
        // BullMQ recommends maxRetriesPerRequest = null + enableReadyCheck =
        // false on workers; this base config is fine for queue producers too.
        maxRetriesPerRequest: null,
      },
      // BullMQ's default prefix is `bull`; namespace it so multiple deploys
      // sharing one Upstash database don't collide.
      prefix: 'bds',
    }),
    BullModule.registerQueue({ name: QUEUE_BILLS_GENERATE }, { name: QUEUE_BILLS_SWEEP }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
