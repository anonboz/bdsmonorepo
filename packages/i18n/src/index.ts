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
