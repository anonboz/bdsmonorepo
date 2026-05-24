/**
 * Phase 11 — client-safe public surface of `@repo/i18n`.
 *
 * Server-only helpers (`getLocaleFromRequest`, `getMessagesFor`) live
 * behind `@repo/i18n/server` so importing them into a client component
 * fails fast with a clean module-not-found instead of dragging
 * `next/headers` into the browser bundle.
 */
export { LOCALE_COOKIE, defaultLocale, isLocale, locales, type Locale } from './config';
export { I18nProvider, type I18nProviderProps } from './client';
export { localeMiddleware } from './middleware';
export { LocaleSwitcher, type LocaleSwitcherProps } from './components/locale-switcher';
/**
 * Phase 11.7 — re-export of the pure format helpers that physically
 * live in `@repo/shared` (no React/Next deps so the API can use them).
 * Surfaced here too so PWA code only needs `@repo/i18n`.
 */
export {
  formatDate,
  formatDateTime,
  formatMoney,
  getFormatters,
  type Formatters,
} from '@repo/shared';
export { useFormatters } from './use-formatters';
