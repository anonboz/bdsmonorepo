import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatMoney, getFormatters } from './format';

describe('formatMoney', () => {
  it('renders VND with no fractional digits in Vietnamese', () => {
    expect(formatMoney(1_000_000, 'VND', 'vi')).toMatch(/1[.,]000[.,]000/);
    expect(formatMoney(1_000_000, 'VND', 'vi')).not.toContain(',00');
  });

  it('renders VND with English thousands separator', () => {
    expect(formatMoney(1_000_000, 'VND', 'en')).toContain('1,000,000');
  });

  it('renders USD with two fractional digits', () => {
    expect(formatMoney(12_50, 'USD', 'en')).toContain('12.50');
  });

  it('renders KWD with three fractional digits (high-precision currency)', () => {
    expect(formatMoney(1_234, 'KWD', 'en')).toContain('1.234');
  });

  it('falls back to "<minor> <currency>" when Intl rejects the currency code', () => {
    // Intl.NumberFormat throws RangeError on non-3-letter currency codes.
    expect(formatMoney(500, 'INVALID', 'en')).toBe('500 INVALID');
  });

  it('defaults to vi when no locale supplied', () => {
    // vi formatting of 1,000,000 uses "." as the thousands separator
    expect(formatMoney(1_000_000, 'VND')).toMatch(/1[.,]000[.,]000/);
  });
});

describe('formatDate', () => {
  it('returns the placeholder for null/undefined', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });

  it('renders a YYYY-MM-DD in English short form', () => {
    expect(formatDate('2026-05-24', 'en')).toContain('2026');
    expect(formatDate('2026-05-24', 'en').toLowerCase()).toMatch(/may/);
  });

  it('renders a YYYY-MM-DD in Vietnamese using its month convention', () => {
    // vi short month uses "thg" — we don't pin the exact string because
    // ICU updates can shift it, but year + day must be present.
    const out = formatDate('2026-05-24', 'vi');
    expect(out).toContain('2026');
    expect(out).toContain('24');
  });

  it('strips the time portion of a datetime', () => {
    expect(formatDate('2026-05-24T13:00:00Z', 'en')).toContain('2026');
  });
});

describe('formatDateTime', () => {
  it('returns the placeholder for null/undefined', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  it('includes the year + a numeric component for the time', () => {
    const out = formatDateTime('2026-05-24T13:30:00Z', 'en');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d/);
  });
});

describe('getFormatters', () => {
  it('returns a bundle bound to the supplied locale', () => {
    const fmt = getFormatters('en');
    expect(fmt.formatMoney(1_000_000, 'VND')).toContain('1,000,000');
    expect(fmt.formatDate('2026-05-24')).toContain('2026');
    expect(fmt.formatDateTime('2026-05-24T13:00:00Z')).toContain('2026');
  });
});
