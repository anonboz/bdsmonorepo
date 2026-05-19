-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "leaseId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Ticket_leaseId_status_idx" ON "Ticket"("leaseId", "status");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
