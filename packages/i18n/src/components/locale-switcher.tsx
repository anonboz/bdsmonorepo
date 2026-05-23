'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { LOCALE_COOKIE, type Locale, locales } from '../config';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Phase 11 — a minimal `<select>` that flips {@link LOCALE_COOKIE}
 * + reloads the page so the server-rendered locale catches up.
 *
 * Intentionally Tailwind-only with no `@repo/ui` dep: this package
 * needs to be a leaf so all four PWAs (including `@repo/ui` itself
 * if it ever imports it) can use it without import cycles.
 */
export function LocaleSwitcher({ current, className }: { current: Locale; className?: string }) {
  const t = useTranslations('common.localeSwitcher');

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.currentTarget.value as Locale;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    // Server-rendered translations need a fresh request to apply.
    window.location.reload();
  }

  return (
    <label className={['inline-flex items-center gap-2 text-sm', className ?? ''].join(' ')}>
      <span className="text-muted-foreground">{t('label')}</span>
      <select
        defaultValue={current}
        onChange={onChange}
        className="rounded-md border bg-background px-2 py-1 text-sm"
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {t.raw(`locales.${code}`) as string}
          </option>
        ))}
      </select>
    </label>
  );
}
