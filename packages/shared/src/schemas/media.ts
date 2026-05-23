import { z } from 'zod';

import { idSchema, isoDateTimeSchema } from './common';

/**
 * Allowed buckets for a media asset. v1 has two — campaign listing
 * photos (owner-driven) and partner job proof-of-work (partner-driven).
 * The enum is pinned here so the API can dispatch on it without a free-
 * form string.
 */
export const MediaPurpose = {
  CAMPAIGN_PHOTO: 'CAMPAIGN_PHOTO',
  JOB_PROOF: 'JOB_PROOF',
} as const;
export type MediaPurpose = (typeof MediaPurpose)[keyof typeof MediaPurpose];
export const mediaPurposeSchema = z.nativeEnum(MediaPurpose);

export const MediaStatus = {
  PENDING: 'PENDING',
  UPLOADED: 'UPLOADED',
  DELETED: 'DELETED',
  /** Phase 10.3 — image processor rejected the bytes (exceeded
   *  MAX_UPLOAD_BYTES after EXIF strip, or processing failed past
   *  max retries). The S3 source is purged; the row stays for audit. */
  REJECTED: 'REJECTED',
} as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];
export const mediaStatusSchema = z.nativeEnum(MediaStatus);

/** Hard cap on an upload's reported size — 20 MiB. S3 itself caps far
 *  higher; this is a UX guard against accidental 200MB phone photos. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const createMediaUploadSchema = z.object({
  purpose: mediaPurposeSchema,
  filename: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((c) => c.startsWith('image/'), 'Only image/* uploads are allowed in v1'),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});
export type CreateMediaUploadInput = z.infer<typeof createMediaUploadSchema>;

export const createMediaUploadResponseSchema = z.object({
  assetId: idSchema,
  /** The URL the client PUTs the file body to. */
  uploadUrl: z.string().url(),
  uploadUrlExpiresAt: isoDateTimeSchema,
  /** What the client should embed in `Campaign.photos` / `ServiceJob.proofPhotos`. */
  publicUrl: z.string().url(),
  /**
   * Headers the client MUST send on the PUT. S3 enforces an exact
   * Content-Type match against the signed policy; we hand the value
   * back so the client can't accidentally diverge.
   */
  requiredHeaders: z.record(z.string(), z.string()),
});
export type CreateMediaUploadResponse = z.infer<typeof createMediaUploadResponseSchema>;

export const mediaAssetSchema = z.object({
  id: idSchema,
  ownerUserId: idSchema,
  purpose: mediaPurposeSchema,
  status: mediaStatusSchema,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  publicUrl: z.string().url(),
  /** Phase 10.3 — set by the image processor once the 320px JPEG
   *  variant is in S3. Null while in flight or for pre-10.3 rows;
   *  clients should fall back to `publicUrl` when null. */
  thumbnailUrl: z.string().url().nullable(),
  filename: z.string(),
  createdAt: isoDateTimeSchema,
  uploadedAt: isoDateTimeSchema.nullable(),
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
