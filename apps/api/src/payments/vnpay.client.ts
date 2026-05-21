import { createHmac } from 'node:crypto';

/**
 * Pure VNPay helpers — signing, URL construction, IPN verification.
 * Kept free of NestJS so they're trivially unit-testable and reusable
 * (the IPN handler in `webhooks.service.ts` calls `verifyIpnSignature`
 * directly, the checkout service calls `buildPaymentUrl`).
 *
 * Implementation follows VNPay's "Sandbox 2.1" documentation:
 *   https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html
 */

/** Required query params for a VNPay payment URL (2.1.0). */
export interface BuildPaymentUrlParams {
  tmnCode: string;
  hashSecret: string;
  paymentUrl: string;
  /** Local Payment row id; becomes `vnp_TxnRef`. */
  txnRef: string;
  /** Bill amount in **VND đồng** (minor units in our schema). VNPay
   *  internally multiplies by 100, so we send `amount * 100`. */
  amount: number;
  orderInfo: string;
  orderType?: string;
  locale?: string;
  /** Browser return URL — the `vnp_ReturnUrl` VNPay redirects to. */
  returnUrl: string;
  /** Client IP from `req.ip`. */
  ipAddress: string;
  /** Optional override for tests; defaults to `now()` in `Asia/Ho_Chi_Minh`. */
  createDate?: string;
}

/**
 * Formats a `Date` as `yyyyMMddHHmmss` in `Asia/Ho_Chi_Minh` (GMT+7).
 * Exported so the spec can pin a deterministic timestamp.
 */
export function formatVnpayDate(date: Date): string {
  // Shift by +7h then format as if UTC — Vietnam doesn't observe DST,
  // so a constant offset is exact.
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const h = String(shifted.getUTCHours()).padStart(2, '0');
  const min = String(shifted.getUTCMinutes()).padStart(2, '0');
  const s = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}${h}${min}${s}`;
}

/**
 * Builds the signed VNPay payment URL. The same URL-encoding scheme
 * is applied to the signed canonical string AND the final URL — the
 * #1 source of "Invalid Signature" bugs in VNPay integrations.
 */
export function buildPaymentUrl(p: BuildPaymentUrlParams): string {
  const params: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: p.tmnCode,
    vnp_Amount: String(p.amount * 100),
    vnp_CurrCode: 'VND',
    vnp_TxnRef: p.txnRef,
    vnp_OrderInfo: p.orderInfo,
    vnp_OrderType: p.orderType ?? 'billpayment',
    vnp_Locale: p.locale ?? 'vn',
    vnp_ReturnUrl: p.returnUrl,
    vnp_IpAddr: p.ipAddress,
    vnp_CreateDate: p.createDate ?? formatVnpayDate(new Date()),
  };

  const canonical = buildCanonicalQueryString(params);
  const hash = createHmac('sha512', p.hashSecret).update(canonical).digest('hex');

  // Re-encode the query the exact same way (sorted alphabetically,
  // values URL-encoded), then append the hash + hash type. VNPay
  // expects them present in the URL but absent from the signed body.
  return `${p.paymentUrl}?${canonical}&vnp_SecureHash=${hash}`;
}

/**
 * Verifies an IPN delivery against the hash secret.
 *
 * Returns `true` only when every required `vnp_*` field is present,
 * the hash matches a fresh recomputation, and the hash type is
 * `SHA512` (or absent — older sandbox).
 */
export function verifyIpnSignature(query: Record<string, string>, hashSecret: string): boolean {
  const provided = query.vnp_SecureHash;
  if (!provided) return false;

  // Strip the hash + hash type before signing — VNPay's docs are
  // explicit that they're added to the URL but excluded from the
  // canonical signed string.
  const signed: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
    if (v === '' || v == null) continue;
    signed[k] = v;
  }

  const canonical = buildCanonicalQueryString(signed);
  const expected = createHmac('sha512', hashSecret).update(canonical).digest('hex');
  // Compare case-insensitively — some VNPay environments uppercase
  // the hex digest.
  return expected.toLowerCase() === provided.toLowerCase();
}

/**
 * Build the canonical query string used both for signing and as the
 * final URL query. Keys sorted alphabetically, values URL-encoded
 * (form-style: spaces become `+`).
 */
function buildCanonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k] ?? '').replace(/%20/g, '+')}`)
    .join('&');
}

export interface VnpayIpnResponse {
  RspCode: '00' | '01' | '02' | '04' | '97' | '99';
  Message: string;
}
