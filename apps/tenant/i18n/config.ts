// Locale model for the tenant PWA. Cookie-based detection, no URL-prefix routing
// (the route tree stays `/`, `/my-leases`, …). The choice persists in a cookie;
// server components read it via `./server`, client components via `./provider`.

export const locales = ["en", "vi", "zh"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that pins the user's chosen language across requests. */
export const LOCALE_COOKIE = "tenant.locale";

/** Native display name per locale, for the switcher. */
export const localeNames: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
  zh: "中文",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
