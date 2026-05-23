import type { Metadata, Viewport } from 'next';
import { getLocale, getMessages } from 'next-intl/server';

import { I18nProvider, type Locale } from '@repo/i18n';

import { APP_NAME } from '../lib/app-config';
import { ServiceWorkerRegister } from './_components/sw-register';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: 'BDS Owner — manage houses, leases, bills, and campaigns.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
  icons: { icon: '/icons/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#1d4ed8',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
