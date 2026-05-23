-- Phase 10.4 — per-channel preferences + quiet hours.

-- CreateEnum
CREATE TYPE "NotificationPreferenceScope" AS ENUM ('ALL', 'EMAIL', 'IN_APP');

-- AlterTable
-- Default ALL so existing 9.4 rows preserve their "mute everything"
-- semantics after the column add. NOT NULL is safe because the
-- default backfills.
ALTER TABLE "NotificationPreference"
  ADD COLUMN "scope" "NotificationPreferenceScope" NOT NULL DEFAULT 'ALL';

-- DropIndex
-- Replace the old (userId, topic) unique with a (userId, topic, scope)
-- unique so each user can carry one row per (topic, scope) tuple.
DROP INDEX "NotificationPreference_userId_topic_key";

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_topic_scope_key"
  ON "NotificationPreference"("userId", "topic", "scope");

-- CreateTable
CREATE TABLE "NotificationQuietHours" (
    "userId" TEXT NOT NULL,
    "startUtcMinute" INTEGER NOT NULL,
    "endUtcMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationQuietHours_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "NotificationQuietHours"
  ADD CONSTRAINT "NotificationQuietHours_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
