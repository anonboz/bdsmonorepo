'use client';

import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import * as React from 'react';

import type { Locale } from './config';

export interface I18nProviderProps {
  locale: Locale;
  messages: AbstractIntlMessages;
  children: React.ReactNode;
}

/**
 * Phase 11 — thin re-export of next-intl's client provider so app
 * layouts have one canonical import. Keeps the next-intl dep
 * confined to `@repo/i18n`; consumers only import from `@repo/i18n`
 * for setup (they still import `useTranslations` etc. from
 * `next-intl` directly inside their components).
 */
export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
