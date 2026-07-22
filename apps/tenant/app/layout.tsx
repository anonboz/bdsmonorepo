import type { Metadata } from "next";

import "./globals.css";
import { getMessages } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { getLocale } from "@/i18n/server";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Tenant — House Renting",
  description: "Renter portal: your leases, bills, and requests.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = getMessages(locale);

  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">
        <Providers>
          <I18nProvider locale={locale} messages={messages}>
            {children}
          </I18nProvider>
        </Providers>
      </body>
    </html>
  );
}
