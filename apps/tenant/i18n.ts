import { getLocaleFromRequest, getMessagesFor } from '@repo/i18n';
import { getRequestConfig } from 'next-intl/server';

/**
 * Phase 11.1 — next-intl request-config hook. The plugin in
 * `next.config.ts` points at this file; next-intl invokes it on
 * every request to resolve the active locale + load its messages.
 */
export default getRequestConfig(async () => {
  const locale = await getLocaleFromRequest();
  return { locale, messages: getMessagesFor(locale) };
});
