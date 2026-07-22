-- CreateTable
CREATE TABLE "UtilityRateBound" (
    "id" TEXT NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "unit" TEXT NOT NULL,
    "minPricePerUnit" INTEGER NOT NULL,
    "maxPricePerUnit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UtilityRateBound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UtilityRateBound_kind_key" ON "UtilityRateBound"("kind");

-- CreateTable
CREATE TABLE "OrgUtilityRate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "InvoiceLineKind" NOT NULL,
    "unit" TEXT NOT NULL,
    "pricePerUnit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgUtilityRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgUtilityRate_organizationId_kind_key" ON "OrgUtilityRate"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "OrgUtilityRate_organizationId_idx" ON "OrgUtilityRate"("organizationId");

-- AddForeignKey
ALTER TABLE "OrgUtilityRate" ADD CONSTRAINT "OrgUtilityRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
