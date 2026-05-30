import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCreateRequest,
  postCreate,
  verifyIpnSignature,
  type MomoIpnBody,
} from './momo.client.js';

const PARTNER_CODE = 'MOMO_TEST';
const ACCESS_KEY = 'F8BBA842ECF85';
const SECRET_KEY = 'K951B6PE1waDMi640xX08PD3vg6EkVlz';
const REDIRECT_URL = 'http://localhost:4020/my-bills/bill_1/momo/return';
const IPN_URL = 'http://localhost:4001/v1/webhooks/momo/ipn';

describe('buildCreateRequest', () => {
  const base = {
    partnerCode: PARTNER_CODE,
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    requestId: 'rq_test_001',
    orderId: 'payment_test_001',
    amount: 500_000,
    orderInfo: 'Rent 2026-06-01 - 2026-06-30',
    redirectUrl: REDIRECT_URL,
    ipnUrl: IPN_URL,
  };

  it('produces a body with the documented requestType + lang defaults', () => {
    const body = buildCreateRequest(base);
    expect(body.requestType).toBe('captureWallet');
    expect(body.lang).toBe('vi');
    expect(body.extraData).toBe('');
    expect(body.partnerCode).toBe(PARTNER_CODE);
    expect(body.orderId).toBe(base.orderId);
    expect(body.amount).toBe(500_000);
  });

  it('respects an explicit lang override', () => {
    const body = buildCreateRequest({ ...base, lang: 'en' });
    expect(body.lang).toBe('en');
  });

  it('signs with HMAC SHA256 over the canonical string in the documented order', () => {
    const body = buildCreateRequest(base);
    // Reproduce the canonical string locally and assert byte-for-byte.
    // If this drifts, MoMo returns "Invalid signature" and the
    // create call 4xx's — burned in.
    const canonical =
      `accessKey=${ACCESS_KEY}` +
      `&amount=500000` +
      `&extraData=` +
      `&ipnUrl=${IPN_URL}` +
      `&orderId=${base.orderId}` +
      `&orderInfo=${base.orderInfo}` +
      `&partnerCode=${PARTNER_CODE}` +
      `&redirectUrl=${REDIRECT_URL}` +
      `&requestId=${base.requestId}` +
      `&requestType=captureWallet`;
    const expected = createHmac('sha256', SECRET_KEY).update(canonical).digest('hex');
    expect(body.signature).toBe(expected);
  });

  it('signature changes when any signed field changes', () => {
    const a = buildCreateRequest(base);
    const b = buildCreateRequest({ ...base, amount: 500_001 });
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('postCreate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs JSON to the supplied URL and returns the parsed response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          partnerCode: PARTNER_CODE,
          requestId: 'rq_test_001',
          orderId: 'order_001',
          amount: 500_000,
          responseTime: Date.now(),
          message: 'Successful.',
          resultCode: 0,
          payUrl: 'https://test-payment.momo.vn/pay/session_xyz',
          deeplink: 'momo://test',
          qrCodeUrl: 'https://...',
        }),
    });
    const body = buildCreateRequest({
      partnerCode: PARTNER_CODE,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      requestId: 'rq_test_001',
      orderId: 'order_001',
      amount: 500_000,
      orderInfo: 'Test',
      redirectUrl: REDIRECT_URL,
      ipnUrl: IPN_URL,
    });
    const result = await postCreate('https://test/api/create', body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toBe('https://test/api/create');
    expect(call[1].method).toBe('POST');
    const sent = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(sent).toMatchObject({
      partnerCode: PARTNER_CODE,
      requestType: 'captureWallet',
      orderId: 'order_001',
    });
    expect(result.resultCode).toBe(0);
    expect(result.payUrl).toContain('momo.vn');
  });

  it('throws on non-2xx HTTP', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: () => Promise.resolve('upstream down'),
    });
    const body = buildCreateRequest({
      partnerCode: PARTNER_CODE,
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      requestId: 'rq',
      orderId: 'o',
      amount: 1,
      orderInfo: 'x',
      redirectUrl: REDIRECT_URL,
      ipnUrl: IPN_URL,
    });
    await expect(postCreate('https://test/api/create', body)).rejects.toThrow(/HTTP 502/);
  });
});

describe('verifyIpnSignature', () => {
  function signedIpn(overrides: Partial<MomoIpnBody> = {}): MomoIpnBody {
    const base: Omit<MomoIpnBody, 'signature'> = {
      partnerCode: PARTNER_CODE,
      orderId: 'order_001',
      requestId: 'rq_001',
      amount: 500_000,
      orderInfo: 'Rent 2026-06-01 - 2026-06-30',
      orderType: 'momo_wallet',
      transId: 14242427,
      resultCode: 0,
      message: 'Successful.',
      payType: 'qr',
      responseTime: 1748100000000,
      extraData: '',
      ...overrides,
    };
    const canonical =
      `accessKey=${ACCESS_KEY}` +
      `&amount=${base.amount}` +
      `&extraData=${base.extraData}` +
      `&message=${base.message}` +
      `&orderId=${base.orderId}` +
      `&orderInfo=${base.orderInfo}` +
      `&orderType=${base.orderType}` +
      `&partnerCode=${base.partnerCode}` +
      `&payType=${base.payType}` +
      `&requestId=${base.requestId}` +
      `&responseTime=${base.responseTime}` +
      `&resultCode=${base.resultCode}` +
      `&transId=${base.transId}`;
    const signature = createHmac('sha256', SECRET_KEY).update(canonical).digest('hex');
    return { ...base, signature };
  }

  it('accepts a correctly-signed IPN', () => {
    const ipn = signedIpn();
    expect(verifyIpnSignature(ipn, ACCESS_KEY, SECRET_KEY)).toBe(true);
  });

  it('rejects when any field has been tampered after signing', () => {
    const ipn = signedIpn();
    expect(verifyIpnSignature({ ...ipn, amount: 1 }, ACCESS_KEY, SECRET_KEY)).toBe(false);
  });

  it('rejects when the signature field is missing', () => {
    const ipn = signedIpn();
    expect(verifyIpnSignature({ ...ipn, signature: '' }, ACCESS_KEY, SECRET_KEY)).toBe(false);
  });

  it('rejects when the access key differs', () => {
    const ipn = signedIpn();
    expect(verifyIpnSignature(ipn, 'wrong_access_key', SECRET_KEY)).toBe(false);
  });

  it('accepts an uppercased hex digest (defensive case-insensitive compare)', () => {
    const ipn = signedIpn();
    expect(
      verifyIpnSignature(
        { ...ipn, signature: ipn.signature.toUpperCase() },
        ACCESS_KEY,
        SECRET_KEY,
      ),
    ).toBe(true);
  });
});
