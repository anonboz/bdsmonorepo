-- Flat monthly fees (internet, trash, parking, cleaning, other).
-- PropertyFee = per-property default; LeaseFee = the lease's own copy, billed
-- on every invoice. Additive only: new enum, new enum values, two new tables.
-- Generated with `prisma migrate diff`, reviewed by hand (no CREATE SCHEMA,
-- all objects unqualified → public), plus non-negative amount checks.

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('internet', 'trash', 'parking', 'cleaning', 'other');

-- AlterEnum


ALTER TYPE "InvoiceLineKind" ADD VALUE 'internet';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'trash';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'parking';
ALTER TYPE "InvoiceLineKind" ADD VALUE 'cleaning';

-- CreateTable
CREATE TABLE "PropertyFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" "FeeKind" NOT NULL,
    "label" TEXT,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PropertyFee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseFee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "propertyFeeId" TEXT,
    "kind" "FeeKind" NOT NULL,
    "label" TEXT,
    "amount" INTEGER NOT NULL,
    "customized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaseFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PropertyFee_organizationId_idx" ON "PropertyFee"("organizationId");

-- CreateIndex
CREATE INDEX "PropertyFee_propertyId_idx" ON "PropertyFee"("propertyId");

-- CreateIndex
CREATE INDEX "LeaseFee_organizationId_idx" ON "LeaseFee"("organizationId");

-- CreateIndex
CREATE INDEX "LeaseFee_leaseId_idx" ON "LeaseFee"("leaseId");

-- CreateIndex
CREATE INDEX "LeaseFee_propertyFeeId_idx" ON "LeaseFee"("propertyFeeId");

-- AddForeignKey
ALTER TABLE "PropertyFee" ADD CONSTRAINT "PropertyFee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertyFee" ADD CONSTRAINT "PropertyFee_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseFee" ADD CONSTRAINT "LeaseFee_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseFee" ADD CONSTRAINT "LeaseFee_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "Lease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseFee" ADD CONSTRAINT "LeaseFee_propertyFeeId_fkey" FOREIGN KEY ("propertyFeeId") REFERENCES "PropertyFee"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Money is integer cents and never negative.
ALTER TABLE "PropertyFee" ADD CONSTRAINT "PropertyFee_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "LeaseFee" ADD CONSTRAINT "LeaseFee_amount_nonnegative" CHECK ("amount" >= 0);
