-- Phase 10.2 — stuck-notifications sweeper bookkeeping.
-- retryCount + lastAttemptAt are bumped only by the sweeper, not by
-- the BullMQ worker, so the counter reflects "rescues" not "send attempts."

-- AlterTable
ALTER TABLE "Notification"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3);

-- CreateIndex
-- Covers the sweep's WHERE sentAt IS NULL AND failureReason IS NULL AND createdAt < ?.
-- Non-partial (Prisma's partial-index syntax doesn't apply cleanly here) but
-- still cheap because most rows are sent within seconds — only the stuck
-- tail survives across windows.
CREATE INDEX "Notification_sweep_idx" ON "Notification"("createdAt");
