-- CreateEnum
CREATE TYPE "JobRatingDirection" AS ENUM ('OWNER_TO_PARTNER', 'PARTNER_TO_OWNER');

-- CreateTable
CREATE TABLE "JobRating" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "ratedId" TEXT NOT NULL,
    "direction" "JobRatingDirection" NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" VARCHAR(2000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRating_ratedId_createdAt_idx" ON "JobRating"("ratedId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRating_jobId_idx" ON "JobRating"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRating_jobId_direction_key" ON "JobRating"("jobId", "direction");

-- AddForeignKey
ALTER TABLE "JobRating" ADD CONSTRAINT "JobRating_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ServiceJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRating" ADD CONSTRAINT "JobRating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRating" ADD CONSTRAINT "JobRating_ratedId_fkey" FOREIGN KEY ("ratedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
