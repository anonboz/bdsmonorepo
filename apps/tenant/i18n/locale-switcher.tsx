"use client";

// Language dropdown. Writes the locale cookie client-side and refreshes so the
// server re-renders in the chosen language. No session write — cookie is the
// source of truth for this slice.

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { LOCALE_COOKIE, locales, localeNames } from "./index";
import { useLocale, useTranslations } from "./provider";

export function LocaleSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("language");
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    // 1 year, path=/ so it applies to every route; lax is fine (same-site nav).
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <select
      aria-label={t("label")}
      value={locale}
      onChange={onChange}
      disabled={pending}
      className={
        className ??
        "h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      }
    >
      {locales.map((code) => (
        <option key={code} value={code}>
          {localeNames[code]}
        </option>
      ))}
    </select>
  );
}
