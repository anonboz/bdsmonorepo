-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "decidedBy" TEXT,
ADD COLUMN     "rejectionReason" VARCHAR(500),
ADD COLUMN     "createdLeaseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Application_createdLeaseId_key" ON "Application"("createdLeaseId");

-- CreateIndex
CREATE INDEX "Application_ownerId_status_idx" ON "Application"("ownerId", "status");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_createdLeaseId_fkey" FOREIGN KEY ("createdLeaseId") REFERENCES "Lease"("id") ON DELETE SET NULL ON UPDATE CASCADE;
