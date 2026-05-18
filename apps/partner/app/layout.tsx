import type { Metadata, Viewport } from 'next';

import { APP_NAME } from '../lib/app-config.js';
import { ServiceWorkerRegister } from './_components/sw-register.js';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s — ${APP_NAME}` },
  description: 'BDS Partner — receive jobs, send quotes, and track payouts.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
  icons: { icon: '/icons/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#b45309',
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
