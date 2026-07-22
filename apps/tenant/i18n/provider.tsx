"use client";

// Client-side i18n context. The root layout seeds it with the request locale +
// catalog (both serializable), so client components get the same `t` API as the
// server via `useTranslations`.

import { createContext, useContext, useMemo } from "react";

import type { Locale, Messages } from "./index";
import { createTranslator, type Translator } from "./translate";

type I18nValue = { locale: Locale; messages: Messages };

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("i18n hooks must be used within <I18nProvider>");
  return ctx;
}

export function useLocale(): Locale {
  return useI18n().locale;
}

export function useTranslations(namespace?: string): Translator {
  const { messages } = useI18n();
  return useMemo(() => createTranslator(messages, namespace), [messages, namespace]);
}
