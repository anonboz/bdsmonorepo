import type { Metadata, Viewport } from 'next';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

import { I18nProvider, type Locale } from '@repo/i18n';

import { APP_NAME } from '../lib/app-config';
import { ServiceWorkerRegister } from './_components/sw-register';
import './globals.css';

/**
 * Phase 11.3 — metadata is locale-aware via next-intl's `getTranslations`
 * (the description copy localizes; the brand name `APP_NAME` stays as-is
 * since it's a proper noun).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tenant');
  return {
    title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
    description: t('appDescription'),
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
    icons: { icon: '/icons/icon.svg' },
  };
}

export const viewport: Viewport = {
  themeColor: '#15803d',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Phase 11.1 — `<html lang>` follows the user's locale so screen
  // readers + browsers know how to handle the page. Messages are
  // hoisted into the client provider for `useTranslations` consumers.
  const locale = (await getLocale()) as Locale;
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ServiceWorkerRegister />
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
