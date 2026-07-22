// @repo/shared/money — money is INTEGER minor units (cents) everywhere in the
// data model + services. Never store or compute money as a float. Convert to a
// display string only at the very edge (UI), using these helpers.

/**
 * Format integer minor units as a Vietnamese đồng amount, INTEGER only — the
 * minor units are dropped at display time. The label and grouping follow the
 * display locale:
 *   - `vi` → "1.850 đ"   (native symbol, dot grouping)
 *   - `en` → "1,850 VND" (ISO code, comma grouping)
 *   - `zh` → "1,850 VND"
 */
export function formatMoney(cents: number, locale = "en"): string {
  const amount = Math.round(cents / 100);
  if (locale.startsWith("vi")) {
    return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(amount)} đ`;
  }
  const bcp47 = locale.startsWith("zh") ? "zh-CN" : "en-US";
  return `${new Intl.NumberFormat(bcp47, { maximumFractionDigits: 0 }).format(amount)} VND`;
}

/** Parse a user-entered major-unit amount ("1250") to integer cents. */
export function parseMoneyToCents(input: string): number {
  const value = Number.parseFloat(input);
  if (Number.isNaN(value)) throw new Error("INVALID_INPUT");
  return Math.round(value * 100);
}
