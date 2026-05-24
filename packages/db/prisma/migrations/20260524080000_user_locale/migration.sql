-- Phase 11.2 — preferred UI language per user. Mirrors `@repo/i18n`'s
-- canonical locale set (`vi` default, `en` opt-in). Default applies to
-- every existing row so the column is NOT NULL from day one without a
-- backfill step.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "locale" VARCHAR(8) NOT NULL DEFAULT 'vi';
