/*
  Warnings:

  - Added the required column `ownerId` to the `Campaign` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "moderationDecidedAt" TIMESTAMP(3),
ADD COLUMN     "moderationDecidedBy" TEXT,
ADD COLUMN     "moderationReason" VARCHAR(500),
ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Campaign_ownerId_status_idx" ON "Campaign"("ownerId", "status");
