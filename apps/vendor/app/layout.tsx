import type { Metadata, Viewport } from "next";

import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Vendor — House Renting",
  description: "Contractor dashboard: work orders, schedule, profile.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { title: "Vendor", statusBarStyle: "default" },
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
