/**
 * Format a money amount stored as integer minor units + ISO-4217 currency
 * code. Uses the runtime's locale via Intl.NumberFormat — fine for now;
 * once we add i18n we'll route through the user's preferred locale.
 *
 *   formatMoney(500_000, 'VND')  // "₫500,000"
 *   formatMoney(12_50,  'USD')   // "$12.50"
 */
export function formatMoney(minor: number, currency: string): string {
  // Best-effort: try the runtime's formatter first, fall back to a literal.
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

/**
 * ISO-4217 minor-unit digit counts that differ from the default 2.
 * Sourced from a small allowlist of currencies we expect to see; the
 * Intl formatter still falls back gracefully for anything else.
 */
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
  // ISO date or datetime — strip time portion if present.
  const day = iso.length > 10 ? iso.slice(0, 10) : iso;
  return new Date(day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
