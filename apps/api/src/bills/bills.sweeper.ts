import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { env } from '../env.js';
import { BillsService } from './bills.service.js';
import {
  JOB_BILLS_DAILY_SWEEP,
  JOB_BILLS_GENERATE,
  type BillsGenerateJobData,
  QUEUE_BILLS_GENERATE,
  QUEUE_BILLS_SWEEP,
  REPEAT_JOB_ID_BILLS_DAILY_SWEEP,
} from '../queues/queue-names.js';

const DAILY_SWEEP_CRON = '0 3 * * *'; // 03:00 UTC every day

/**
 * Two things in one class because they're tightly coupled:
 *
 * 1. `BillsSweepScheduler.onApplicationBootstrap` registers the repeating
 *    `bills.daily-sweep` job once at startup. The repeat job id is stable
 *    (`REPEAT_JOB_ID_BILLS_DAILY_SWEEP`) so re-running this on every boot
 *    is a no-op rather than scheduling duplicates.
 *
 * 2. `process()` runs whenever BullMQ fires the daily sweep. It asks the
 *    BillsService for every lease that needs a bill for the current period,
 *    then enqueues one `bills.generate` job per lease into the *other*
 *    queue. The generation worker (BillsProcessor) does the actual work.
 *
 * When API_DISABLE_QUEUES=true (unit tests) the scheduler skips
 * registration; processors won't fire because no Redis is connected.
 */
@Injectable()
@Processor(QUEUE_BILLS_SWEEP)
export class BillsSweepScheduler extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(BillsSweepScheduler.name);

  constructor(
    private readonly bills: BillsService,
    @InjectQueue(QUEUE_BILLS_SWEEP) private readonly sweepQueue: Queue,
    @InjectQueue(QUEUE_BILLS_GENERATE) private readonly generateQueue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (env.API_DISABLE_QUEUES) {
      this.logger.warn('queues disabled — skipping daily-sweep registration');
      return;
    }
    await this.sweepQueue.add(
      JOB_BILLS_DAILY_SWEEP,
      {},
      {
        repeat: { pattern: DAILY_SWEEP_CRON },
        // Stable job id so the registration is idempotent across restarts.
        jobId: REPEAT_JOB_ID_BILLS_DAILY_SWEEP,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.log(`registered repeating job '${JOB_BILLS_DAILY_SWEEP}' (${DAILY_SWEEP_CRON})`);
  }

  override async process(job: Job): Promise<{ enqueued: number }> {
    if (job.name !== JOB_BILLS_DAILY_SWEEP) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_BILLS_SWEEP} queue`);
      return { enqueued: 0 };
    }

    const due = await this.bills.findLeasesNeedingBillFor();
    this.logger.log(`sweep found ${due.length} lease(s) needing a bill`);

    await Promise.all(
      due.map((d) =>
        this.generateQueue.add(JOB_BILLS_GENERATE, d satisfies BillsGenerateJobData, {
          jobId: `gen:${d.leaseId}:${d.periodStart}`,
          removeOnComplete: 200,
          removeOnFail: 50,
        }),
      ),
    );
    return { enqueued: due.length };
  }
}
