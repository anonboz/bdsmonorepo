'use client';

import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import { getFormatters, type Formatters } from '@repo/shared';

import { defaultLocale, isLocale, type Locale } from './config';

/**
 * Phase 11.7 — client-side counterpart of {@link getFormatters}.
 * Reads the active locale via `next-intl`'s `useLocale()` and returns
 * a bundle of formatters bound to it; memoized on the locale so
 * components don't re-build the bundle on every render.
 *
 *   'use client';
 *   const { formatMoney, formatDate } = useFormatters();
 *   ...
 *   <span>{formatMoney(amount, currency)}</span>
 */
export function useFormatters(): Formatters {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : defaultLocale;
  return useMemo(() => getFormatters(locale), [locale]);
}
