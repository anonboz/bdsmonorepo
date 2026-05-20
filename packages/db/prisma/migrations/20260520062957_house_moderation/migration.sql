-- CreateEnum
CREATE TYPE "HouseModerationStatus" AS ENUM ('OK', 'FLAGGED', 'REJECTED');

-- AlterTable
ALTER TABLE "House" ADD COLUMN     "moderationDecidedAt" TIMESTAMP(3),
ADD COLUMN     "moderationDecidedBy" TEXT,
ADD COLUMN     "moderationReason" VARCHAR(500),
ADD COLUMN     "moderationStatus" "HouseModerationStatus" NOT NULL DEFAULT 'OK';

-- CreateIndex
CREATE INDEX "House_moderationStatus_createdAt_idx" ON "House"("moderationStatus", "createdAt");
