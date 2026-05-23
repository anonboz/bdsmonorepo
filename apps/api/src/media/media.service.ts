import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';

import {
  ErrorCodes,
  MAX_UPLOAD_BYTES,
  type CreateMediaUploadInput,
  type CreateMediaUploadResponse,
  type MediaAsset as MediaAssetResponse,
} from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { StorageService } from '../common/storage/storage.service.js';
import {
  JOB_MEDIA_PROCESS,
  QUEUE_MEDIA_PROCESS,
  type MediaProcessJobData,
} from '../queues/queue-names.js';

type MediaAssetRow = Awaited<ReturnType<PrismaInstance['mediaAsset']['findUnique']>>;

/**
 * Pluggable image processor abstraction. Production uses
 * {@link SharpImageProcessor}; specs inject a deterministic stub so we
 * don't burn CPU on real sharp encode/decode in every test.
 */
export interface ImageProcessor {
  /** Re-encode the source to the same MIME type, dropping EXIF.
   *  Property syntax (not method shorthand) so the methods are
   *  callable as detached references — keeps spec assertions clean. */
  stripExif: (input: { bytes: Buffer; contentType: string }) => Promise<Buffer>;
  /** Inscribe into a 320×320 box, encode as JPEG (q=75). */
  thumbnail: (input: { bytes: Buffer }) => Promise<Buffer>;
}

export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');

/** Output of the per-row processing pass. Surfaced for the worker
 *  logger + the spec assertions. */
export type ProcessAssetResult =
  | { status: 'processed'; assetId: string; thumbnailKey: string }
  | { status: 'rejected'; assetId: string; reason: string }
  | { status: 'already-processed'; assetId: string }
  | { status: 'not-found'; assetId: string }
  | { status: 'skipped'; assetId: string; reason: string };

/**
 * Pre-signed-PUT upload coordinator. The flow:
 *
 *   1. Client posts to `POST /v1/media/uploads`. We insert a PENDING
 *      MediaAsset row + hand back a signed PUT URL.
 *   2. Client PUTs the file bytes directly to S3.
 *   3. Client posts to `POST /v1/media/uploads/:id/confirm`. We
 *      HEAD-check the bucket; if the object's there and within the
 *      size cap the caller declared up-front, we flip the row to
 *      `UPLOADED`.
 *
 * Cross-user ids return 404 (existence-hiding) — same as the rest of
 * the API.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_MEDIA_PROCESS) private readonly processQueue: Queue<MediaProcessJobData>,
    @Inject(IMAGE_PROCESSOR) private readonly imageProcessor: ImageProcessor,
    private readonly audit: AuditLogger,
  ) {}

  async createUpload(
    ownerUserId: string,
    input: CreateMediaUploadInput,
  ): Promise<CreateMediaUploadResponse> {
    const bucket = this.storage.bucketUploads;
    // We pre-create the row to allocate the cuid so the key can
    // embed it; this keeps key derivation deterministic + collision-
    // free even before any S3 round-trip.
    const provisional = await this.prisma.mediaAsset.create({
      data: {
        ownerUserId,
        purpose: input.purpose,
        status: 'PENDING',
        provider: 's3',
        bucket,
        // We patch `key` + `publicUrl` immediately below once we
        // know the row's id. Insert with stubs to satisfy NOT NULL.
        key: '__pending__',
        publicUrl: '__pending__',
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      },
    });
    const key = this.storage.buildKey({
      purpose: input.purpose,
      ownerUserId,
      assetId: provisional.id,
      filename: input.filename,
    });
    const publicUrl = this.storage.publicUrl(bucket, key);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: provisional.id },
      data: { key, publicUrl },
    });
    const presigned = await this.storage.presignPut({
      bucket,
      key,
      contentType: input.contentType,
    });
    return {
      assetId: updated.id,
      uploadUrl: presigned.url,
      uploadUrlExpiresAt: presigned.expiresAt.toISOString(),
      publicUrl,
      requiredHeaders: presigned.requiredHeaders,
    };
  }

  /**
   * Verifies the client actually completed the PUT. We HEAD the
   * object; absence → 422 `media.upload_not_found`. Size beyond the
   * declared cap → 422 `media.size_mismatch` (defends against the
   * "I claimed 1MB but sent 5GB" trick).
   */
  async confirmUpload(ownerUserId: string, assetId: string): Promise<MediaAssetResponse> {
    const row = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (row?.ownerUserId !== ownerUserId) throw this.notFound();
    if (row.status === 'UPLOADED') return this.toResponse(row);
    if (row.status !== 'PENDING') {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.MEDIA_NOT_PENDING,
        title: 'Asset is not awaiting confirmation',
        detail: `Asset ${assetId} is in ${row.status} state.`,
      });
    }
    const head = await this.storage.headObject({ bucket: row.bucket, key: row.key });
    if (!head) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.MEDIA_UPLOAD_NOT_FOUND,
        title: 'Upload not found in storage',
        detail: 'The PUT may have failed or never completed. Re-issue an upload URL.',
      });
    }
    if (head.sizeBytes > row.sizeBytes) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.MEDIA_SIZE_MISMATCH,
        title: 'Uploaded object exceeds declared size',
        detail: `Declared ${row.sizeBytes} bytes; uploaded ${head.sizeBytes}.`,
      });
    }
    const updated = await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: { status: 'UPLOADED', uploadedAt: new Date(), sizeBytes: head.sizeBytes },
    });
    // Phase 10.3 — fan out to the image processor. We swallow queue
    // errors so a Redis blip doesn't surface as a confirm failure;
    // the row sits with processedAt=null until a future re-process.
    try {
      await this.processQueue.add(
        JOB_MEDIA_PROCESS,
        { assetId: updated.id },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 100,
        },
      );
    } catch (err) {
      this.logger.warn(`media.process enqueue failed for ${updated.id}: ${(err as Error).message}`);
    }
    return this.toResponse(updated);
  }

  /**
   * Phase 10.3 — worker entry point. Reads the S3 object, strips EXIF
   * by re-encoding through sharp, emits a 320px thumbnail variant,
   * rejects the row when the stripped bytes exceed
   * {@link MAX_UPLOAD_BYTES}. Idempotent: a row already past
   * `processedAt` returns `already-processed` without doing any work.
   */
  async processAsset(assetId: string): Promise<ProcessAssetResult> {
    const row = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!row) return { status: 'not-found', assetId };
    if (row.processedAt) return { status: 'already-processed', assetId };
    if (row.status !== 'UPLOADED') {
      return {
        status: 'skipped',
        assetId,
        reason: `asset is in ${row.status} state, not UPLOADED`,
      };
    }

    const bytes = await this.storage.getObject({ bucket: row.bucket, key: row.key });
    if (!bytes) {
      // S3 says the object is gone — likely the GDPR-erasure flow
      // raced us. Surface as a soft skip rather than a hard failure;
      // there's nothing to retry against.
      return {
        status: 'skipped',
        assetId,
        reason: 'source object no longer present in storage',
      };
    }

    const stripped = await this.imageProcessor.stripExif({
      bytes,
      contentType: row.contentType,
    });

    if (stripped.length > MAX_UPLOAD_BYTES) {
      // Byte-level reject path — purge the S3 source so we don't
      // keep paying storage on something we just refused. Audit
      // before the destructive write so ops can correlate.
      await this.audit.writeOnce({
        actorId: null,
        action: 'media.process.rejected',
        target: `MediaAsset:${row.id}`,
        meta: {
          ownerUserId: row.ownerUserId,
          purpose: row.purpose,
          declaredBytes: row.sizeBytes,
          strippedBytes: stripped.length,
          reason: 'exceeded MAX_UPLOAD_BYTES after EXIF strip',
        },
      });
      await this.storage.deleteObject({ bucket: row.bucket, key: row.key });
      const reason = `stripped bytes (${stripped.length}) exceed ${MAX_UPLOAD_BYTES}`;
      await this.prisma.mediaAsset.update({
        where: { id: row.id },
        data: {
          status: 'REJECTED',
          processedAt: new Date(),
          processingFailureReason: reason,
        },
      });
      return { status: 'rejected', assetId, reason };
    }

    const thumbnail = await this.imageProcessor.thumbnail({ bytes: stripped });
    const thumbnailKey = `${row.key}.thumb.jpg`;

    // Order matters: write both objects before we publish the row's
    // thumbnailUrl. A reader who sees thumbnailUrl in DB but 404s on
    // S3 is a worse failure than thumbnailUrl staying null another
    // sweep window.
    await this.storage.putObject({
      bucket: row.bucket,
      key: row.key,
      body: stripped,
      contentType: row.contentType,
    });
    await this.storage.putObject({
      bucket: row.bucket,
      key: thumbnailKey,
      body: thumbnail,
      contentType: 'image/jpeg',
    });

    const thumbnailUrl = this.storage.publicUrl(row.bucket, thumbnailKey);
    await this.prisma.mediaAsset.update({
      where: { id: row.id },
      data: {
        thumbnailUrl,
        thumbnailKey,
        sizeBytes: stripped.length,
        processedAt: new Date(),
      },
    });
    await this.audit.writeOnce({
      actorId: null,
      action: 'media.process.completed',
      target: `MediaAsset:${row.id}`,
      meta: {
        ownerUserId: row.ownerUserId,
        purpose: row.purpose,
        strippedBytes: stripped.length,
        thumbnailBytes: thumbnail.length,
      },
    });
    return { status: 'processed', assetId, thumbnailKey };
  }

  /**
   * Final-failure hook called by the worker when BullMQ exhausts its
   * retry budget. Lands `processingFailureReason` on the row so ops
   * greps one column. Idempotent — the worker can call this on a
   * row that already has the reason set (does nothing).
   */
  async markProcessingFailed(assetId: string, message: string): Promise<void> {
    await this.prisma.mediaAsset.updateMany({
      where: { id: assetId, processedAt: null },
      data: { processingFailureReason: message.slice(0, 2000), processedAt: new Date() },
    });
  }

  async getForUser(ownerUserId: string, assetId: string): Promise<MediaAssetResponse> {
    const row = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (row?.ownerUserId !== ownerUserId) throw this.notFound();
    return this.toResponse(row);
  }

  private notFound(): ProblemError {
    return new ProblemError({
      status: 404,
      type: ErrorCodes.MEDIA_NOT_FOUND,
      title: 'Media asset not found',
    });
  }

  private toResponse(row: NonNullable<MediaAssetRow>): MediaAssetResponse {
    return {
      id: row.id,
      ownerUserId: row.ownerUserId,
      purpose: row.purpose,
      status: row.status,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      publicUrl: row.publicUrl,
      thumbnailUrl: row.thumbnailUrl,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    };
  }
}
