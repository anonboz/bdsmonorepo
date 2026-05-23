-- Phase 10.6 — self-serve account-deletion request + per-user
-- grace window on PlatformConfig.

-- AlterTable
ALTER TABLE "PlatformConfig"
  ADD COLUMN "accountErasureGraceDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "AccountErasureRequest" (
    "userId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executeAfter" TIMESTAMP(3) NOT NULL,
    "undoToken" VARCHAR(128) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountErasureRequest_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
-- Supports the sweeper's eligibility scan.
CREATE INDEX "AccountErasureRequest_executeAfter_cancelledAt_completedAt_idx"
  ON "AccountErasureRequest"("executeAfter", "cancelledAt", "completedAt");

-- AddForeignKey
ALTER TABLE "AccountErasureRequest"
  ADD CONSTRAINT "AccountErasureRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
