import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { NotificationsService, type SweepResult } from './notifications.service.js';
import { env } from '../env.js';
import {
  JOB_NOTIFICATIONS_STUCK_SWEEP,
  QUEUE_NOTIFICATIONS_STUCK_SWEEP,
  REPEAT_JOB_ID_NOTIFICATIONS_STUCK_SWEEP,
} from '../queues/queue-names.js';

// Every 15 minutes. Cadence is independent of the 1-hour eligibility
// floor — see SWEEP_MIN_AGE_MS in notifications.service.ts.
const STUCK_SWEEP_CRON = '*/15 * * * *';

/**
 * BullMQ scheduler + processor (Phase 10.2). Closes the 8.2 follow-up:
 * a backstop that picks up `Notification` rows the send pipeline never
 * finalized (Redis blip during enqueue, worker dropped, etc.) and
 * re-enqueues them. Each visit writes an audit row; rows that survive
 * three sweeps land a `failureReason` so ops greps one column.
 *
 * Same idempotent-registration + API_DISABLE_QUEUES pattern as the
 * bills + payouts sweepers.
 */
@Injectable()
@Processor(QUEUE_NOTIFICATIONS_STUCK_SWEEP)
export class NotificationsStuckSweeper extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsStuckSweeper.name);

  constructor(
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_NOTIFICATIONS_STUCK_SWEEP) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (env.API_DISABLE_QUEUES) {
      this.logger.warn('queues disabled — skipping stuck-sweep registration');
      return;
    }
    await this.queue.add(
      JOB_NOTIFICATIONS_STUCK_SWEEP,
      {},
      {
        repeat: { pattern: STUCK_SWEEP_CRON },
        jobId: REPEAT_JOB_ID_NOTIFICATIONS_STUCK_SWEEP,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.log(
      `registered repeating job '${JOB_NOTIFICATIONS_STUCK_SWEEP}' (${STUCK_SWEEP_CRON})`,
    );
  }

  override async process(job: Job): Promise<SweepResult> {
    if (job.name !== JOB_NOTIFICATIONS_STUCK_SWEEP) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_NOTIFICATIONS_STUCK_SWEEP}`);
      return { inspected: 0, retried: 0, gaveUp: 0 };
    }
    const result = await this.notifications.sweepStuck();
    if (result.inspected > 0) {
      this.logger.log(
        `stuck sweep: inspected=${result.inspected} retried=${result.retried} gaveUp=${result.gaveUp}`,
      );
    }
    return result;
  }
}
