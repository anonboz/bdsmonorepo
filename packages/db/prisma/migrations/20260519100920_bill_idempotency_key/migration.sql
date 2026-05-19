-- AlterTable
ALTER TABLE "Bill" ADD COLUMN "idempotencyKey" VARCHAR(64) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Bill_leaseId_idempotencyKey_key" ON "Bill"("leaseId", "idempotencyKey");
