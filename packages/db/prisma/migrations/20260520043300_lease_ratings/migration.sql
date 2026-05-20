-- CreateEnum
CREATE TYPE "RatingMilestone" AS ENUM ('MOVE_IN', 'MID_LEASE', 'MOVE_OUT');

-- CreateEnum
CREATE TYPE "RatingDirection" AS ENUM ('TENANT_TO_OWNER', 'OWNER_TO_TENANT');

-- CreateTable
CREATE TABLE "LeaseRating" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "ratedId" TEXT NOT NULL,
    "direction" "RatingDirection" NOT NULL,
    "milestone" "RatingMilestone" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaseRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaseRating_ratedId_createdAt_idx" ON "LeaseRating"("ratedId", "createdAt");

-- CreateIndex
CREATE INDEX "LeaseRating_leaseId_idx" ON "LeaseRating"("leaseId");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseRating_leaseId_direction_milestone_key" ON "LeaseRating"("leaseId", "direction", "milestone");

-- AddForeignKey
ALTER TABLE "LeaseRating" ADD CONSTRAINT "LeaseRating_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseRating" ADD CONSTRAINT "LeaseRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseRating" ADD CONSTRAINT "LeaseRating_ratedId_fkey" FOREIGN KEY ("ratedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
