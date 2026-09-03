import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Find your next home — House Renting",
  description: "Browse published rental listings across every city.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "Listings", statusBarStyle: "default" },
  icons: { apple: "/icons/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#1f8e66",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
