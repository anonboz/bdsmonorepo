-- AlterEnum
ALTER TYPE "PayoutEntryStatus" ADD VALUE 'DISBURSED';

-- CreateEnum
CREATE TYPE "PayoutDisbursementMethod" AS ENUM ('MANUAL_BANK_TRANSFER', 'STRIPE_CONNECT');

-- AlterTable
ALTER TABLE "JobLedgerEntry"
  ADD COLUMN "disbursedAt" TIMESTAMP(3),
  ADD COLUMN "disbursementRef" VARCHAR(200),
  ADD COLUMN "disbursementMethod" "PayoutDisbursementMethod",
  ADD COLUMN "disbursedById" TEXT;

-- CreateIndex
CREATE INDEX "JobLedgerEntry_status_disbursedAt_idx" ON "JobLedgerEntry"("status", "disbursedAt");
