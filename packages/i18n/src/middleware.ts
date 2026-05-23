import type { NextRequest, NextResponse } from 'next/server';

import { LOCALE_COOKIE, type Locale, defaultLocale, isLocale, locales } from './config';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Phase 11 — middleware helper that ensures every incoming request
 * has a {@link LOCALE_COOKIE} cookie. Mutates the outgoing `res`
 * by setting the cookie when it's missing.
 *
 * Existing app middlewares stay in charge of their own trace-id /
 * auth logic; they call this helper once per request so future
 * server components can rely on the cookie being present.
 */
export function localeMiddleware(req: NextRequest, res: NextResponse): Locale {
  const fromCookie = req.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const accept = req.headers.get('accept-language');
  const detected = detectFromAccept(accept) ?? defaultLocale;
  res.cookies.set(LOCALE_COOKIE, detected, {
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: 'lax',
  });
  return detected;
}

function detectFromAccept(accept: string | null): Locale | null {
  if (!accept) return null;
  for (const part of accept.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Re-export for app middlewares that want to enumerate locales. */
export { locales, defaultLocale };
