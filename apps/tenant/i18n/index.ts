// Client-safe barrel: catalogs + config + types. No `next/headers` import here, so
// this is importable from client components. Server-only helpers live in `./server`.

import { type Locale } from "./config";
import en, { type Messages } from "./messages/en";
import vi from "./messages/vi";
import zh from "./messages/zh";

export type { Locale, Messages };
export { locales, defaultLocale, localeNames, isLocale, LOCALE_COOKIE } from "./config";

export const dictionaries: Record<Locale, Messages> = { en, vi, zh };

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale];
}
