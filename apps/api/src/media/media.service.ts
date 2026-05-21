import { Inject, Injectable } from '@nestjs/common';

import {
  ErrorCodes,
  type CreateMediaUploadInput,
  type CreateMediaUploadResponse,
  type MediaAsset as MediaAssetResponse,
} from '@repo/shared';

import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { StorageService } from '../common/storage/storage.service.js';

type MediaAssetRow = Awaited<ReturnType<PrismaInstance['mediaAsset']['findUnique']>>;

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
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly storage: StorageService,
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
    return this.toResponse(updated);
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
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    };
  }
}
