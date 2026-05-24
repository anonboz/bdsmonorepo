import { createHmac } from 'node:crypto';

/**
 * Pure MoMo helpers — request signing, IPN verification, HTTP call.
 * Kept free of NestJS so they're trivially unit-testable; the Nest
 * service (`MomoService`) is a DI facade over these.
 *
 * Reference: MoMo v2 captureWallet flow.
 *   https://developers.momo.vn/v3/docs/payment/api/wallet/onetime
 */

export interface BuildCreateRequestParams {
  partnerCode: string;
  accessKey: string;
  secretKey: string;
  /** Stable per-call cuid (also surfaced into AuditLog meta). */
  requestId: string;
  /** Local Payment row id. Becomes MoMo's `orderId`. */
  orderId: string;
  /** Bill amount in **VND đồng** (minor units in our schema). MoMo
   *  accepts the same integer — no `* 100` multiplier like VNPay. */
  amount: number;
  orderInfo: string;
  /** Browser redirect URL — MoMo bounces back here after the payment. */
  redirectUrl: string;
  /** Server-to-server IPN URL — MoMo POSTs the outcome here. */
  ipnUrl: string;
  /** UI locale for the hosted page (`"vi"` or `"en"`). */
  lang?: 'vi' | 'en';
  /**
   * Opaque tag echoed back in the IPN. Empty string by default; reserved
   * for future use (e.g. tenant id for analytics). Must be empty or
   * base64 per MoMo's spec.
   */
  extraData?: string;
}

export interface MomoCreateRequestBody {
  partnerCode: string;
  requestId: string;
  amount: number;
  orderId: string;
  orderInfo: string;
  redirectUrl: string;
  ipnUrl: string;
  requestType: 'captureWallet';
  extraData: string;
  lang: 'vi' | 'en';
  signature: string;
}

/**
 * Builds the JSON body POSTed to MoMo's `/v2/gateway/api/create`.
 *
 * Canonical signed string (alphabetised fields, in this exact order
 * per MoMo's spec — burned in, do NOT re-sort by code):
 *
 *   accessKey=$accessKey&amount=$amount&extraData=$extraData
 *     &ipnUrl=$ipnUrl&orderId=$orderId&orderInfo=$orderInfo
 *     &partnerCode=$partnerCode&redirectUrl=$redirectUrl
 *     &requestId=$requestId&requestType=$requestType
 *
 * HMAC SHA256 with `secretKey`, lowercase hex digest.
 */
export function buildCreateRequest(p: BuildCreateRequestParams): MomoCreateRequestBody {
  const extraData = p.extraData ?? '';
  const lang = p.lang ?? 'vi';
  const requestType = 'captureWallet' as const;

  const canonical =
    `accessKey=${p.accessKey}` +
    `&amount=${p.amount}` +
    `&extraData=${extraData}` +
    `&ipnUrl=${p.ipnUrl}` +
    `&orderId=${p.orderId}` +
    `&orderInfo=${p.orderInfo}` +
    `&partnerCode=${p.partnerCode}` +
    `&redirectUrl=${p.redirectUrl}` +
    `&requestId=${p.requestId}` +
    `&requestType=${requestType}`;

  const signature = createHmac('sha256', p.secretKey).update(canonical).digest('hex');

  return {
    partnerCode: p.partnerCode,
    requestId: p.requestId,
    amount: p.amount,
    orderId: p.orderId,
    orderInfo: p.orderInfo,
    redirectUrl: p.redirectUrl,
    ipnUrl: p.ipnUrl,
    requestType,
    extraData,
    lang,
    signature,
  };
}

/** Subset of MoMo's `/create` response that the checkout flow reads. */
export interface MomoCreateResponse {
  partnerCode: string;
  requestId: string;
  orderId: string;
  amount: number;
  responseTime: number;
  message: string;
  resultCode: number;
  payUrl?: string;
  deeplink?: string;
  qrCodeUrl?: string;
}

/**
 * POSTs a signed create-payment request and returns the parsed JSON.
 * Caller is responsible for checking `resultCode === 0` and reading
 * `payUrl`.
 *
 * Thin wrapper around `fetch` so tests can mock with `vi.stubGlobal`
 * — no separate HTTP-layer abstraction.
 */
export async function postCreate(
  createUrl: string,
  body: MomoCreateRequestBody,
): Promise<MomoCreateResponse> {
  const response = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`momo create HTTP ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as MomoCreateResponse;
}

/** Shape of the IPN body MoMo POSTs to our webhook. */
export interface MomoIpnBody {
  partnerCode: string;
  orderId: string;
  requestId: string;
  amount: number;
  orderInfo: string;
  orderType: string;
  transId: number;
  resultCode: number;
  message: string;
  payType: string;
  responseTime: number;
  extraData: string;
  signature: string;
}

/**
 * Verifies an IPN body against the configured access/secret keys.
 *
 * Canonical string (alphabetised fields, in this exact order — burned
 * into MoMo's docs, do NOT auto-sort):
 *
 *   accessKey=$accessKey&amount=$amount&extraData=$extraData
 *     &message=$message&orderId=$orderId&orderInfo=$orderInfo
 *     &orderType=$orderType&partnerCode=$partnerCode&payType=$payType
 *     &requestId=$requestId&responseTime=$responseTime
 *     &resultCode=$resultCode&transId=$transId
 *
 * Returns `true` only when every required field is present and the
 * recomputed HMAC SHA256 (lowercase hex) matches the body's
 * `signature`.
 */
export function verifyIpnSignature(
  body: MomoIpnBody,
  accessKey: string,
  secretKey: string,
): boolean {
  if (!body.signature) return false;

  const canonical =
    `accessKey=${accessKey}` +
    `&amount=${body.amount}` +
    `&extraData=${body.extraData}` +
    `&message=${body.message}` +
    `&orderId=${body.orderId}` +
    `&orderInfo=${body.orderInfo}` +
    `&orderType=${body.orderType}` +
    `&partnerCode=${body.partnerCode}` +
    `&payType=${body.payType}` +
    `&requestId=${body.requestId}` +
    `&responseTime=${body.responseTime}` +
    `&resultCode=${body.resultCode}` +
    `&transId=${body.transId}`;

  const expected = createHmac('sha256', secretKey).update(canonical).digest('hex');
  // Compare case-insensitively — defensive; MoMo's reference output
  // is lowercase but some integrations have surfaced uppercase digests.
  return expected.toLowerCase() === body.signature.toLowerCase();
}
