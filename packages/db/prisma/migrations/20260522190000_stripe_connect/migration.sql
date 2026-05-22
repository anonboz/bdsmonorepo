-- CreateEnum
CREATE TYPE "StripeConnectStatus" AS ENUM ('NOT_STARTED', 'ONBOARDING', 'ACTIVE', 'RESTRICTED');

-- AlterTable
ALTER TABLE "PartnerProfile"
  ADD COLUMN "stripeConnectAccountId" VARCHAR(60),
  ADD COLUMN "stripeConnectStatus" "StripeConnectStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "stripeConnectOnboardedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProfile_stripeConnectAccountId_key" ON "PartnerProfile"("stripeConnectAccountId");
