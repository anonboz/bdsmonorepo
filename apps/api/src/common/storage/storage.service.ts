import { PutObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, Optional } from '@nestjs/common';

import { env } from '../../env.js';

export interface PresignPutInput {
  bucket: string;
  key: string;
  contentType: string;
  expiresInSec?: number;
}

export interface PresignPutResult {
  url: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
}

export interface HeadObjectResult {
  sizeBytes: number;
}

/**
 * Thin wrapper over `@aws-sdk/client-s3` so the rest of the API can
 * talk to MinIO locally + S3 in prod without scattering SDK construction
 * across services. Stateless — the underlying `S3Client` is created
 * once at module load.
 *
 * Tests instantiate {@link StorageService} with a stubbed S3Client
 * via the constructor override; see `media.service.spec.ts`.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly defaultBucket: string;
  private readonly publicBase: string | null;
  private readonly defaultExpiresInSec: number;

  // `@Optional()` is required under NestJS 11: without it Nest tries to
  // resolve `S3Client` from the DI graph and the boot fails because we
  // never register one as a provider. Tests instantiate StorageService
  // directly with a stubbed client, so the parameter is genuinely
  // optional in the runtime contract.
  constructor(@Optional() client?: S3Client) {
    this.client =
      client ??
      new S3Client({
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
    this.defaultBucket = env.S3_BUCKET_UPLOADS;
    this.publicBase = env.S3_PUBLIC_BASE.length > 0 ? env.S3_PUBLIC_BASE : null;
    this.defaultExpiresInSec = env.S3_PRESIGN_EXPIRES_SEC;
  }

  get bucketUploads(): string {
    return this.defaultBucket;
  }

  /**
   * Builds a collision-safe S3 key under `${purpose}/${ownerUserId}/`.
   * `assetId` is a cuid; including it in the path guarantees uniqueness
   * even across concurrent uploads with the same filename. The
   * sanitized filename is appended for human-readable diagnostics in
   * the S3 console — the cuid is the actual uniqueness guarantee.
   */
  buildKey(opts: {
    purpose: string;
    ownerUserId: string;
    assetId: string;
    filename: string;
  }): string {
    const sanitized = sanitizeFilename(opts.filename);
    return `${opts.purpose.toLowerCase()}/${opts.ownerUserId}/${opts.assetId}/${sanitized}`;
  }

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    const expiresIn = input.expiresInSec ?? this.defaultExpiresInSec;
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      // S3 enforces the Content-Type signed into the policy; the
      // client gets back exactly the header it must send.
      requiredHeaders: { 'Content-Type': input.contentType },
    };
  }

  async headObject(input: { bucket: string; key: string }): Promise<HeadObjectResult | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }),
      );
      return { sizeBytes: result.ContentLength ?? 0 };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      this.logger.warn(
        `headObject failed for ${input.bucket}/${input.key}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  /**
   * Public-facing URL the client embeds in `Campaign.photos` /
   * `ServiceJob.proofPhotos`. Uses `S3_PUBLIC_BASE` when set
   * (CDN / proxy path); falls back to `S3_ENDPOINT/${bucket}/${key}`.
   * MinIO buckets are anonymous-read in dev so this URL is fetchable
   * straight away; in prod the bucket policy is the source of truth
   * for accessibility.
   */
  publicUrl(bucket: string, key: string): string {
    const base = this.publicBase ?? env.S3_ENDPOINT;
    return `${base.replace(/\/$/, '')}/${bucket}/${key}`;
  }
}

/**
 * Strips path separators, dots-only segments, control chars, and any
 * non-`[A-Za-z0-9._-]` so the resulting fragment is safe to splice
 * into an S3 key. Truncates to 100 chars to keep keys short.
 *
 * Exported for unit tests; not used elsewhere.
 */
export function sanitizeFilename(input: string): string {
  const stripped = input
    // Drop everything before the last path separator (caller may have
    // sent `C:\Users\...`).
    .split(/[\\/]/)
    .pop()!
    // Replace control chars + reserved URL chars with `_`.
    .replace(/[^A-Za-z0-9._-]/g, '_')
    // Collapse runs of `_`.
    .replace(/_+/g, '_')
    // Drop leading dots so `..` and `.hidden` don't slip through.
    .replace(/^\.+/, '');
  const safe = stripped.length > 0 ? stripped : 'file';
  return safe.slice(0, 100);
}
