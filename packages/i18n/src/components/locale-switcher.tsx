'use client';

import { useTranslations } from 'next-intl';
import * as React from 'react';

import { LOCALE_COOKIE, type Locale, locales } from '../config';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface LocaleSwitcherProps {
  current: Locale;
  className?: string;
  /**
   * Phase 11.2 — optional server-side persistence hook. PWAs that have
   * an authenticated session pass a callback (typically
   * `(locale) => api.patch('/v1/me', { locale })`) so the change lands
   * on `User.locale` in addition to the cookie. The callback is awaited
   * before reload; failures bubble (the calling component decides
   * whether to surface them).
   *
   * When omitted, the switcher only updates the cookie — the right
   * behaviour for unauthenticated visitors and for surfaces that
   * intentionally stay local-only.
   */
  onSave?: (locale: Locale) => Promise<void> | void;
}

/**
 * Phase 11 — a minimal `<select>` that flips {@link LOCALE_COOKIE}
 * + reloads the page so the server-rendered locale catches up.
 *
 * Intentionally Tailwind-only with no `@repo/ui` dep: this package
 * needs to be a leaf so all four PWAs (including `@repo/ui` itself
 * if it ever imports it) can use it without import cycles.
 */
export function LocaleSwitcher({ current, className, onSave }: LocaleSwitcherProps) {
  const t = useTranslations('common.localeSwitcher');
  const [pending, setPending] = React.useState(false);

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.currentTarget.value as Locale;
    if (next === current) return;

    setPending(true);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    try {
      if (onSave) await onSave(next);
    } finally {
      // Server-rendered translations need a fresh request to apply,
      // even when the server save fails — at least the cookie is set
      // and the next request will render the chosen language.
      window.location.reload();
    }
  }

  return (
    <label className={['inline-flex items-center gap-2 text-sm', className ?? ''].join(' ')}>
      <span className="text-muted-foreground">{t('label')}</span>
      <select
        defaultValue={current}
        onChange={onChange}
        disabled={pending}
        className="rounded-md border bg-background px-2 py-1 text-sm disabled:opacity-60"
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
