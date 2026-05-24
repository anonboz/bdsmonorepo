import 'server-only';
import { cookies, headers } from 'next/headers';
import type { AbstractIntlMessages } from 'next-intl';

import { LOCALE_COOKIE, type Locale, defaultLocale, isLocale } from './config';
import enCommon from './messages/en/common.json';
import enPartner from './messages/en/partner.json';
import enTenant from './messages/en/tenant.json';
import viCommon from './messages/vi/common.json';
import viPartner from './messages/vi/partner.json';
import viTenant from './messages/vi/tenant.json';

/**
 * Phase 11 — server-side locale detection.
 *
 * Priority:
 *   1. {@link LOCALE_COOKIE} cookie (set by the locale switcher or
 *      by Phase 11.2's `User.locale` upsert).
 *   2. First supported locale in `Accept-Language`.
 *   3. {@link defaultLocale} fallback.
 *
 * Returns one of the values in {@link locales} — never throws.
 */
export async function getLocaleFromRequest(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const headerStore = await headers();
  const accept = headerStore.get('accept-language');
  if (accept) {
    for (const part of accept.split(',')) {
      const tag = part.split(';')[0]?.trim().toLowerCase();
      if (!tag) continue;
      // Accept-Language can be "vi-VN" — match on the primary subtag.
      const primary = tag.split('-')[0];
      if (isLocale(primary)) return primary;
    }
  }
  return defaultLocale;
}

/**
 * Catalogs bundled into the loader, keyed by `<locale>.<namespace>`.
 * Per-app namespaces are added here so all four PWAs hit one canonical
 * tree — `useTranslations('tenant.account')` etc. Bundle impact is
 * tiny (JSON, no code), and routing-by-namespace stays a presentation
 * concern at the call-site.
 */
const messageCatalogs: Record<Locale, AbstractIntlMessages> = {
  en: { common: enCommon, tenant: enTenant, partner: enPartner },
  vi: { common: viCommon, tenant: viTenant, partner: viPartner },
};

/**
 * Lazy message bundle loader used by each PWA's `i18n.ts`
 * (next-intl's request-config hook). Returns a flat tree keyed by
 * namespace so consumers can call `useTranslations('common')`.
 */
export function getMessagesFor(locale: Locale): AbstractIntlMessages {
  return messageCatalogs[locale];
}
