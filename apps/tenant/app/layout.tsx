import type { Metadata, Viewport } from 'next';

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
