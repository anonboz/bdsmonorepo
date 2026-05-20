import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';

import { CampaignsService } from './campaigns.service.js';
import { env } from '../env.js';
import {
  JOB_CAMPAIGNS_DAILY_EXPIRY,
  QUEUE_CAMPAIGNS_EXPIRY,
  REPEAT_JOB_ID_CAMPAIGNS_DAILY_EXPIRY,
} from '../queues/queue-names.js';

// 1h after bills.daily-sweep (`0 3 * * *`) so we don't double up Postgres load.
const DAILY_EXPIRY_CRON = '0 4 * * *';

/**
 * Daily BullMQ sweep that flips LIVE campaigns past their `expiresAt`
 * to EXPIRED, writing one `campaign.expire` audit row per row. Same
 * idempotent-registration pattern as `BillsSweepScheduler`.
 *
 * When `API_DISABLE_QUEUES=true` (unit tests) registration is skipped
 * and processors don't fire because no Redis is connected.
 */
@Injectable()
@Processor(QUEUE_CAMPAIGNS_EXPIRY)
export class CampaignsExpirySweeper extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(CampaignsExpirySweeper.name);

  constructor(
    private readonly campaigns: CampaignsService,
    @InjectQueue(QUEUE_CAMPAIGNS_EXPIRY) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (env.API_DISABLE_QUEUES) {
      this.logger.warn('queues disabled — skipping campaign-expiry registration');
      return;
    }
    await this.queue.add(
      JOB_CAMPAIGNS_DAILY_EXPIRY,
      {},
      {
        repeat: { pattern: DAILY_EXPIRY_CRON },
        jobId: REPEAT_JOB_ID_CAMPAIGNS_DAILY_EXPIRY,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    this.logger.log(
      `registered repeating job '${JOB_CAMPAIGNS_DAILY_EXPIRY}' (${DAILY_EXPIRY_CRON})`,
    );
  }

  override async process(job: Job): Promise<{ expired: number }> {
    if (job.name !== JOB_CAMPAIGNS_DAILY_EXPIRY) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_CAMPAIGNS_EXPIRY} queue`);
      return { expired: 0 };
    }
    const expired = await this.campaigns.expireOverdue();
    this.logger.log(`expired ${expired} campaign(s)`);
    return { expired };
  }
}
