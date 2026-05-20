/**
 * Format a money amount stored as integer minor units + ISO-4217 currency.
 * Quadruplicate sighting now — should be promoted to a shared web-kit
 * once an explicit cleanup pass runs.
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
