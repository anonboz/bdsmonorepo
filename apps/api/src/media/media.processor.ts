import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MediaService, type ProcessAssetResult } from './media.service.js';
import {
  JOB_MEDIA_PROCESS,
  QUEUE_MEDIA_PROCESS,
  type MediaProcessJobData,
} from '../queues/queue-names.js';

/**
 * BullMQ worker that drives the Phase 10.3 image-processing pipeline.
 * The class is intentionally thin: it dispatches to
 * {@link MediaService.processAsset} (which owns the EXIF strip +
 * thumbnail + reject logic) and lands the final-failure reason on the
 * row via {@link MediaService.markProcessingFailed} once attempts hit
 * the cap. Same shape as `NotificationsSendWorker` for ops continuity.
 */
@Injectable()
@Processor(QUEUE_MEDIA_PROCESS)
export class MediaProcessWorker extends WorkerHost {
  private readonly logger = new Logger(MediaProcessWorker.name);

  constructor(private readonly media: MediaService) {
    super();
  }

  override async process(job: Job<MediaProcessJobData>): Promise<ProcessAssetResult> {
    if (job.name !== JOB_MEDIA_PROCESS) {
      this.logger.warn(`unknown job name '${job.name}' on ${QUEUE_MEDIA_PROCESS}`);
      return { status: 'skipped', assetId: job.data.assetId, reason: 'unknown job name' };
    }
    const result = await this.media.processAsset(job.data.assetId);
    if (result.status === 'processed') {
      this.logger.log(`processed media ${result.assetId} → ${result.thumbnailKey}`);
    } else if (result.status === 'rejected') {
      this.logger.warn(`rejected media ${result.assetId}: ${result.reason}`);
    }
    return result;
  }

  /**
   * BullMQ Worker `failed` event — fires after `attemptsMade` hits
   * `opts.attempts`. We persist the error reason on the row so ops
   * can grep one column instead of digging into Redis.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<MediaProcessJobData>, err: Error): Promise<void> {
    if (!job?.opts?.attempts || job.attemptsMade < job.opts.attempts) {
      // Still retrying — don't pollute the row yet.
      return;
    }
    this.logger.error(`media ${job.data.assetId} failed past max retries: ${err.message}`);
    await this.media.markProcessingFailed(job.data.assetId, err.message).catch(() => {
      // updateMany on a non-existent row returns count:0 (no throw);
      // catch any Prisma-side error so we don't crash the worker
      // process in a failure path that's already terminal.
    });
  }
}
