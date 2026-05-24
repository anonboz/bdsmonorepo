-- Phase 12.3 — Contract e-signature v1.
-- Adds AWAITING_SIGNATURES to LeaseStatus, creates the SignatureRole
-- enum + the Signature table. Additive — existing rows are untouched;
-- new leases still default to DRAFT.

-- AlterEnum
ALTER TYPE "LeaseStatus" ADD VALUE 'AWAITING_SIGNATURES' BEFORE 'ACTIVE';

-- CreateEnum
CREATE TYPE "SignatureRole" AS ENUM ('OWNER', 'TENANT');

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "signerId" TEXT NOT NULL,
    "role" "SignatureRole" NOT NULL,
    -- Base64-encoded PNG data URI; app-level cap is 100 KB raw string.
    "imageDataUri" TEXT NOT NULL,
    "ip" VARCHAR(45),
    "userAgent" VARCHAR(500),
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — one signature per (lease, role); upsert in the service
-- replaces an existing row on re-sign.
CREATE UNIQUE INDEX "Signature_leaseId_role_key" ON "Signature"("leaseId", "role");

-- CreateIndex
CREATE INDEX "Signature_signerId_idx" ON "Signature"("signerId");

-- AddForeignKey — cascade with the lease so cancelling a lease
-- drops the captured signatures (re-edit → re-sign).
ALTER TABLE "Signature"
    ADD CONSTRAINT "Signature_leaseId_fkey"
    FOREIGN KEY ("leaseId") REFERENCES "Lease"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — restrict on signer so we never anonymise a
-- signature out from under the audit trail.
ALTER TABLE "Signature"
    ADD CONSTRAINT "Signature_signerId_fkey"
    FOREIGN KEY ("signerId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
