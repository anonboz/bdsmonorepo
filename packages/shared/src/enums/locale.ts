import { z } from 'zod';

/**
 * Phase 11.2 — mirror of `@repo/i18n`'s canonical locale set. Defined
 * here too because `@repo/shared` is a leaf consumed by the API + the
 * four PWAs; `@repo/i18n` (which depends on `next-intl`) cannot be
 * pulled into the API. Keep the two in sync — adding a locale means
 * updating both files.
 */
export const Locale = {
  vi: 'vi',
  en: 'en',
} as const;
export type Locale = (typeof Locale)[keyof typeof Locale];

export const localeSchema = z.nativeEnum(Locale);

export const defaultLocale: Locale = Locale.vi;

/**
 * Shared cookie name for the user's preferred locale. The API
 * (`PATCH /v1/me`) and the PWA middleware / locale switcher all read +
 * write this one key. Lives in `@repo/shared` so the backend doesn't
 * need to pull in `@repo/i18n` (which transitively depends on Next.js).
 */
export const LOCALE_COOKIE = 'bds-locale';
