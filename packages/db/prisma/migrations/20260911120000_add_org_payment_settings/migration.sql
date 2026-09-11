-- CreateTable
CREATE TABLE "OrgPaymentSettings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "acceptCash" BOOLEAN NOT NULL DEFAULT true,
    "acceptBankTransfer" BOOLEAN NOT NULL DEFAULT false,
    "cashInstructions" TEXT,
    "bankBin" TEXT,
    "bankName" TEXT,
    "bankAccountNo" TEXT,
    "bankAccountName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgPaymentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgPaymentSettings_organizationId_key" ON "OrgPaymentSettings"("organizationId");

-- AddForeignKey
ALTER TABLE "OrgPaymentSettings" ADD CONSTRAINT "OrgPaymentSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
