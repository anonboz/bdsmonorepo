-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN "providerCaptureRef" TEXT,
  ADD COLUMN "refundOfPaymentId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_refundOfPaymentId_idx" ON "Payment"("refundOfPaymentId");

-- AddForeignKey
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_refundOfPaymentId_fkey"
  FOREIGN KEY ("refundOfPaymentId") REFERENCES "Payment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
