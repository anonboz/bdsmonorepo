import { AsyncLocalStorage } from 'node:async_hooks';

import type { Locale } from '@repo/shared';

interface LocaleContext {
  /** Value of the `bds-locale` cookie on the inbound request, if any. */
  cookieLocale: Locale | null;
}

/**
 * Phase 11.2 — request-scoped channel between {@link AuthController}
 * (which sees the inbound HTTP cookies) and the better-auth
 * `databaseHooks.user.create.after` hook (which doesn't). When a brand
 * new user row is created during signup we want to stamp
 * `User.locale` from the visitor's chosen language instead of letting
 * the DB default (`vi`) win.
 *
 * Better-Auth runs the user-create hook synchronously inside the
 * handler call we wrap in {@link runWithLocale}, so the
 * `AsyncLocalStorage` value is in scope. Outside that wrap the store
 * is empty — callers must tolerate `null` and fall back to the DB
 * default.
 */
export const localeContext = new AsyncLocalStorage<LocaleContext>();

export function runWithLocale<T>(cookieLocale: Locale | null, fn: () => Promise<T>): Promise<T> {
  return localeContext.run({ cookieLocale }, fn);
}

export function getCookieLocale(): Locale | null {
  return localeContext.getStore()?.cookieLocale ?? null;
}
