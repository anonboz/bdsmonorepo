// Server-only locale helpers. Reads the locale cookie via `next/headers`; importing
// this from a client component fails the build (which is intentional — use
// `./provider` there instead).

import { cookies, headers } from "next/headers";

import { defaultLocale, isLocale, locales, LOCALE_COOKIE, type Locale } from "./config";
import { getMessages } from "./index";
import { createTranslator, type Translator } from "./translate";

/**
 * Highest-preference supported locale in an `Accept-Language` header, else null.
 * Honors quality values ("vi;q=0.8, en;q=0.9" → en), so the visitor's actual
 * system/browser language wins rather than merely the first tag listed.
 */
function negotiate(acceptLanguage: string | null): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [rawTag, ...params] = part.trim().split(";");
      // "en-US" → base tag "en".
      const tag = rawTag?.trim().toLowerCase().split("-")[0];
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number.parseFloat(qParam.split("=")[1] ?? "") : 1;
      return { tag, q: Number.isNaN(q) ? 1 : q, index };
    })
    // Sort by quality desc; ties keep the header's own order.
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const { tag } of ranked) {
    const match = locales.find((l) => l === tag);
    if (match) return match;
  }
  return null;
}

/** The active locale for this request: cookie → Accept-Language → default. */
export async function getLocale(): Promise<Locale> {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(raw)) return raw;
  return negotiate((await headers()).get("accept-language")) ?? defaultLocale;
}

/** A translator bound to this request's locale, optionally scoped to a namespace. */
export async function getTranslations(namespace?: string): Promise<Translator> {
  const locale = await getLocale();
  return createTranslator(getMessages(locale), namespace);
}
