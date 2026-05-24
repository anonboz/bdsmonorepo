import { defaultLocale, Locale } from './enums/locale';

/**
 * Phase 11.7 — locale-aware money + date formatters. Pure helpers, no
 * runtime deps on React or Next.js, so the API + workers + any leaf
 * package can pull them in. The React-side hook lives in `@repo/i18n`
 * (`useFormatters`) and reads the active locale from `next-intl`.
 *
 *   formatMoney(1_000_000, 'VND', 'vi')  // "1.000.000 ₫"
 *   formatMoney(1_000_000, 'VND', 'en')  // "VND 1,000,000"
 *   formatDate('2026-05-24', 'vi')       // "24 thg 5, 2026"
 *   formatDate('2026-05-24', 'en')       // "May 24, 2026"
 *
 * Omitting `locale` falls back to {@link defaultLocale} (`'vi'`).
 */

const MINOR_UNIT_DIGITS: Record<string, number> = {
  VND: 0,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

const KNOWN_LOCALES: readonly Locale[] = [Locale.vi, Locale.en];

function narrowLocale(value: string | null | undefined): Locale {
  return value != null && (KNOWN_LOCALES as readonly string[]).includes(value)
    ? (value as Locale)
    : defaultLocale;
}

/**
 * Render an integer minor-unit amount + ISO-4217 currency in the
 * caller's locale. Fractional-digit precision follows the currency,
 * not the locale: VND / JPY / KRW are zero-decimal; KWD / BHD / OMR
 * are three; everything else defaults to two. The Intl formatter
 * itself handles thousands separators + symbol placement per locale.
 *
 * Falls back to `<minor> <currency>` if the Intl formatter rejects
 * the currency code (non-3-letter / non-ISO-4217 input).
 */
export function formatMoney(minor: number, currency: string, locale?: Locale): string {
  try {
    const fractionDigits = MINOR_UNIT_DIGITS[currency] ?? 2;
    const major = minor / 10 ** fractionDigits;
    return new Intl.NumberFormat(locale ?? defaultLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    return `${minor} ${currency}`;
  }
}

/**
 * Render an ISO-8601 date (or datetime) as a locale-formatted day.
 * Strips the time portion if present so the same helper works for
 * `'2026-05-24'` and `'2026-05-24T13:00:00Z'`. Returns `'—'` for
 * null/undefined so callers don't have to branch.
 */
export function formatDate(iso: string | null | undefined, locale?: Locale): string {
  if (!iso) return '—';
  const day = iso.length > 10 ? iso.slice(0, 10) : iso;
  return new Date(day).toLocaleDateString(locale ?? defaultLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Render an ISO-8601 datetime with locale conventions for both the
 * date + time portions. Returns `'—'` for null/undefined.
 */
export function formatDateTime(iso: string | null | undefined, locale?: Locale): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale ?? defaultLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface Formatters {
  formatMoney: (minor: number, currency: string) => string;
  formatDate: (iso: string | null | undefined) => string;
  formatDateTime: (iso: string | null | undefined) => string;
}

/**
 * Build a bundle of locale-bound formatters. Useful from server
 * components and worker code:
 *
 *   const fmt = getFormatters(await getLocale());
 *   <span>{fmt.formatMoney(amount, currency)}</span>
 *
 * Accepts the raw `string` from `next-intl`'s `getLocale()` (it's
 * untyped beyond `string`); off-spec values fall back to
 * {@link defaultLocale}.
 */
export function getFormatters(locale: string | null | undefined): Formatters {
  const narrowed = narrowLocale(locale);
  return {
    formatMoney: (minor, currency) => formatMoney(minor, currency, narrowed),
    formatDate: (iso) => formatDate(iso, narrowed),
    formatDateTime: (iso) => formatDateTime(iso, narrowed),
  };
}
