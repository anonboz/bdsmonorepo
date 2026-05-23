import type { Metadata, Viewport } from 'next';
import { getLocale, getMessages } from 'next-intl/server';

import { I18nProvider, type Locale } from '@repo/i18n';

import { APP_NAME } from '../lib/app-config';
import { ServiceWorkerRegister } from './_components/sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: 'BDS Tenant — view bills, pay, raise repairs, leave feedback.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
  icons: { icon: '/icons/icon.svg' },
};

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
