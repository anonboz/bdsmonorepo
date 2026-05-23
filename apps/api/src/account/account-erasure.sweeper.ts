import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { AccountErasureService } from './account-erasure.service.js';
import { env } from '../env.js';
import {
  JOB_ACCOUNT_ERASURE_SWEEP,
  QUEUE_ACCOUNT_ERASURE_SWEEP,
  REPEAT_JOB_ID_ACCOUNT_ERASURE_SWEEP,
} from '../queues/queue-names.js';

// 04:15 UTC daily — after bills (03:00) and payouts (02:00) so the
// DB pressure curves don't overlap.
const DAILY_ERASURE_CRON = '15 4 * * *';

/**
 * Phase 10.6 — BullMQ scheduler + processor for the self-serve
 * erasure flow. Same idempotent-registration + `API_DISABLE_QUEUES`
 * pattern as the other sweepers (bills, payouts, notifications-stuck).
 */
@Injectable()
@Processor(QUEUE_ACCOUNT_ERASURE_SWEEP)
export class AccountErasureSweeper extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(AccountErasureSweeper.name);

  constructor(
    private readonly service: AccountErasureService,
    @InjectQueue(QUEUE_ACCOUNT_ERASURE_SWEEP) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (env.API_DISABLE_QUEUES) {
      this.logger.warn('queues disabled — skipping account-erasure sweep registration');
      return;
    }
    await this.queue.add(
      JOB_ACCOUNT_ERASURE_SWEEP,
      {},
      {
        repeat: { pattern: DAILY_ERASURE_CRON },
        jobId: REPEAT_JOB_ID_ACCOUNT_ERASURE_SWEEP,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.log(
      `registered repeating job '${JOB_ACCOUNT_ERASURE_SWEEP}' (${DAILY_ERASURE_CRON})`,
    );
  }

  override async process(job: Job): Promise<{ executed: number; skipped: number }> {
    if (job.name !== JOB_ACCOUNT_ERASURE_SWEEP) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_ACCOUNT_ERASURE_SWEEP}`);
      return { executed: 0, skipped: 0 };
    }
    return this.service.executeIfDue();
  }
}
