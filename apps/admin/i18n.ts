import { getLocaleFromRequest, getMessagesFor } from '@repo/i18n/server';
import { getRequestConfig } from 'next-intl/server';

/** Phase 11.1 — next-intl request-config hook. Admin app is wired the same
 *  way as the other PWAs even though Phase 11.4 carves it out of the bulk
 *  string-extraction (admin stays English-only). The infrastructure being
 *  in place means localizing later is a config flip. */
export default getRequestConfig(async () => {
  const locale = await getLocaleFromRequest();
  return { locale, messages: getMessagesFor(locale) };
});
