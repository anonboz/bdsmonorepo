-- CreateTable: platform-wide payment method catalog (admin-managed)
CREATE TABLE "PaymentMethodCatalog" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethodCatalog_pkey" PRIMARY KEY ("key")
);

-- Seed the catalog: bank transfer + cash on by default, future rails off.
INSERT INTO "PaymentMethodCatalog" ("key", "enabled", "sortOrder", "updatedAt") VALUES
    ('bank_transfer', true,  0, CURRENT_TIMESTAMP),
    ('cash',          true,  1, CURRENT_TIMESTAMP),
    ('card',          false, 2, CURRENT_TIMESTAMP),
    ('ewallet',       false, 3, CURRENT_TIMESTAMP),
    ('points',        false, 4, CURRENT_TIMESTAMP);

-- OrgPaymentSettings: per-method booleans → a list of accepted catalog keys
ALTER TABLE "OrgPaymentSettings" ADD COLUMN "acceptedMethods" TEXT[] NOT NULL DEFAULT ARRAY['bank_transfer']::TEXT[];

UPDATE "OrgPaymentSettings" SET "acceptedMethods" = ARRAY_REMOVE(ARRAY[
    CASE WHEN "acceptBankTransfer" THEN 'bank_transfer' END,
    CASE WHEN "acceptCash" THEN 'cash' END
], NULL);

ALTER TABLE "OrgPaymentSettings" DROP COLUMN "acceptCash";
ALTER TABLE "OrgPaymentSettings" DROP COLUMN "acceptBankTransfer";
