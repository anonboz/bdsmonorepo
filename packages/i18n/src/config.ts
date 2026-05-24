/**
 * Phase 11 — single source of truth for the platform's locale set.
 *
 * `vi` is the default per the §8 decision in BUILD_PLAN.md; `en` is
 * an explicit opt-in via the locale switcher. Adding another language
 * later means appending to {@link locales}, dropping new JSON files
 * under `messages/<code>/`, and shipping the translations — no other
 * code changes.
 *
 * The {@link Locale} type + `LOCALE_COOKIE` constant are re-exported
 * here so per-PWA code only needs to import from `@repo/i18n`. The
 * underlying definitions live in `@repo/shared` so the API can read +
 * write the same cookie without pulling Next.js into the backend.
 */
export { LOCALE_COOKIE, type Locale } from '@repo/shared';

import { Locale } from '@repo/shared';

export const locales = ['vi', 'en'] as const;

export const defaultLocale: Locale = Locale.vi;

/** Type guard for narrowing arbitrary strings to the known set. */
export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
