-- Phase 10.3 — image-processing worker bookkeeping on MediaAsset.

-- AlterEnum
-- REJECTED is set when the worker finds bytes over MAX_UPLOAD_BYTES
-- after EXIF strip, or gives up past max retries. The S3 source is
-- purged in that path; the row stays for audit + link integrity.
ALTER TYPE "MediaStatus" ADD VALUE 'REJECTED';

-- AlterTable
-- thumbnailUrl + thumbnailKey land when the worker writes the 320px
-- variant back to S3. Null on pre-10.3 rows and while in-flight;
-- clients fall back to publicUrl.
-- processedAt + processingFailureReason mirror the
-- Notification.lastAttemptAt / failureReason pattern from 10.2.
ALTER TABLE "MediaAsset"
  ADD COLUMN "thumbnailUrl" VARCHAR(800),
  ADD COLUMN "thumbnailKey" VARCHAR(500),
  ADD COLUMN "processedAt" TIMESTAMP(3),
  ADD COLUMN "processingFailureReason" VARCHAR(2000);
