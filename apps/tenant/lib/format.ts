/**
 * Format a money amount stored as integer minor units + ISO-4217 currency.
 * Mirrors apps/owner/lib/format.ts — promote to @repo/ui or a shared
 * @repo/web-kit once a third app needs it.
 */
export function formatMoney(minor: number, currency: string): string {
  try {
    const fractionDigits = MINOR_UNIT_DIGITS[currency] ?? 2;
    const major = minor / 10 ** fractionDigits;
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(major);
  } catch {
    return `${minor} ${currency}`;
  }
}

const MINOR_UNIT_DIGITS: Record<string, number> = {
  VND: 0,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const day = iso.length > 10 ? iso.slice(0, 10) : iso;
  return new Date(day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
