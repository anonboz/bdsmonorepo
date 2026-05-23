-- CreateTable
CREATE TABLE "PlatformConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "commissionBps" INTEGER NOT NULL DEFAULT 1000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row inline so the API never sees a missing-row
-- 404 on fresh installs. The application also has a defensive fallback,
-- but the canonical path is "row exists with defaults right after migrate".
INSERT INTO "PlatformConfig" ("id", "commissionBps", "createdAt", "updatedAt")
VALUES ('singleton', 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
