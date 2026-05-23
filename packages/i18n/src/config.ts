/**
 * Phase 11 — single source of truth for the platform's locale set.
 *
 * `vi` is the default per the §8 decision in BUILD_PLAN.md; `en` is
 * an explicit opt-in via the locale switcher. Adding another language
 * later means appending to {@link locales}, dropping new JSON files
 * under `messages/<code>/`, and shipping the translations — no other
 * code changes.
 */
export const locales = ['vi', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'vi';

/**
 * Cookie name shared by every PWA. Reading + writing through one
 * constant keeps the locale-switcher + middleware + server helpers
 * from drifting.
 */
export const LOCALE_COOKIE = 'bds-locale';

/** Type guard for narrowing arbitrary strings to the known set. */
export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (locales as readonly string[]).includes(value);
}
