-- CreateEnum
CREATE TYPE "PayoutEntryKind" AS ENUM ('CHARGE', 'COMMISSION', 'PAYOUT');

-- CreateEnum
CREATE TYPE "PayoutEntryStatus" AS ENUM ('PENDING', 'HELD', 'RELEASED');

-- CreateTable
CREATE TABLE "JobLedgerEntry" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "PayoutEntryKind" NOT NULL,
    "status" "PayoutEntryStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "accountUserId" TEXT,
    "cooldownUntil" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobLedgerEntry_jobId_kind_idx" ON "JobLedgerEntry"("jobId", "kind");

-- CreateIndex
CREATE INDEX "JobLedgerEntry_accountUserId_status_idx" ON "JobLedgerEntry"("accountUserId", "status");

-- CreateIndex
CREATE INDEX "JobLedgerEntry_status_cooldownUntil_idx" ON "JobLedgerEntry"("status", "cooldownUntil");

-- AddForeignKey
ALTER TABLE "JobLedgerEntry" ADD CONSTRAINT "JobLedgerEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
