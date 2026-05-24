import { getLocaleFromRequest, getMessagesFor } from '@repo/i18n/server';
import { getRequestConfig } from 'next-intl/server';

/** Phase 11.1 — next-intl request-config hook. */
export default getRequestConfig(async () => {
  const locale = await getLocaleFromRequest();
  return { locale, messages: getMessagesFor(locale) };
});
