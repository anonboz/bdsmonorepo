-- AlterTable
ALTER TABLE "ServiceJob" ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "unitId" TEXT,
ADD COLUMN     "description" VARCHAR(2000),
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "proofPhotos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "ServiceJob_ownerId_status_idx" ON "ServiceJob"("ownerId", "status");
