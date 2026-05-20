import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { PayoutsService } from './payouts.service.js';
import { env } from '../env.js';
import {
  JOB_PAYOUTS_DAILY_RELEASE,
  QUEUE_PAYOUTS_RELEASE,
  REPEAT_JOB_ID_PAYOUTS_DAILY_RELEASE,
} from '../queues/queue-names.js';

// 02:00 UTC — 1h before the bills sweep at 03:00 to keep DB load spread.
const DAILY_RELEASE_CRON = '0 2 * * *';

/**
 * Daily BullMQ sweep that flips HELD payout entries past their
 * `cooldownUntil` to RELEASED, writing one `payout.release` audit row
 * per row. Same idempotent-registration pattern as the other sweepers.
 */
@Injectable()
@Processor(QUEUE_PAYOUTS_RELEASE)
export class PayoutsReleaseSweeper extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(PayoutsReleaseSweeper.name);

  constructor(
    private readonly payouts: PayoutsService,
    @InjectQueue(QUEUE_PAYOUTS_RELEASE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (env.API_DISABLE_QUEUES) {
      this.logger.warn('queues disabled — skipping payouts-release registration');
      return;
    }
    await this.queue.add(
      JOB_PAYOUTS_DAILY_RELEASE,
      {},
      {
        repeat: { pattern: DAILY_RELEASE_CRON },
        jobId: REPEAT_JOB_ID_PAYOUTS_DAILY_RELEASE,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.log(
      `registered repeating job '${JOB_PAYOUTS_DAILY_RELEASE}' (${DAILY_RELEASE_CRON})`,
    );
  }

  override async process(job: Job): Promise<{ released: number }> {
    if (job.name !== JOB_PAYOUTS_DAILY_RELEASE) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_PAYOUTS_RELEASE} queue`);
      return { released: 0 };
    }
    const released = await this.payouts.releaseEligible();
    return { released };
  }
}
