// @repo/shared/money — money is INTEGER minor units (cents) everywhere in the
// data model + services. Never store or compute money as a float. Convert to a
// display string only at the very edge (UI), using these helpers.

/** Format integer cents as a currency string, e.g. 125000 → "$1,250.00". */
export function formatMoney(cents: number, currency = "USD", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** Parse a user-entered major-unit amount ("1250.00") to integer cents. */
export function parseMoneyToCents(input: string): number {
  const value = Number.parseFloat(input);
  if (Number.isNaN(value)) throw new Error("INVALID_INPUT");
  return Math.round(value * 100);
}
