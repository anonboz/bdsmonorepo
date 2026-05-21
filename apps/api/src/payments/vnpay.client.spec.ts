import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildPaymentUrl, formatVnpayDate, verifyIpnSignature } from './vnpay.client.js';

const HASH_SECRET = 'TEST_HASH_SECRET_DO_NOT_USE_IN_PROD';
const TMN_CODE = 'TESTSHOP';
const PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const RETURN_URL = 'http://localhost:3020/my-bills/bill_1/vnpay/return';

describe('formatVnpayDate', () => {
  it('formats GMT+7 as YYYYMMDDHHMMSS', () => {
    // 2026-05-21T00:00:00Z → 2026-05-21T07:00:00 GMT+7
    const d = new Date('2026-05-21T00:00:00Z');
    expect(formatVnpayDate(d)).toBe('20260521070000');
  });

  it('rolls correctly across the UTC midnight boundary', () => {
    // 2026-05-20T18:00:00Z → 2026-05-21T01:00:00 GMT+7
    const d = new Date('2026-05-20T18:00:00Z');
    expect(formatVnpayDate(d)).toBe('20260521010000');
  });
});

describe('buildPaymentUrl', () => {
  it('builds a sorted, encoded, HMAC-SHA512-signed URL', () => {
    const url = buildPaymentUrl({
      tmnCode: TMN_CODE,
      hashSecret: HASH_SECRET,
      paymentUrl: PAYMENT_URL,
      txnRef: 'pay_abc',
      amount: 5_000_00, // 500,000 VND in minor units
      orderInfo: 'Rent 2026-05',
      returnUrl: RETURN_URL,
      ipAddress: '203.0.113.1',
      createDate: '20260521120000',
    });

    expect(url.startsWith(`${PAYMENT_URL}?`)).toBe(true);
    expect(url).toContain('vnp_Amount=50000000'); // *100
    expect(url).toContain('vnp_TmnCode=TESTSHOP');
    expect(url).toContain('vnp_TxnRef=pay_abc');
    expect(url).toContain('vnp_OrderInfo=Rent+2026-05'); // form-style encoding
    expect(url).toContain('vnp_CreateDate=20260521120000');
    expect(url).toContain('vnp_SecureHash=');

    // The signed canonical string should match a fresh recomputation.
    const queryString = url.slice(`${PAYMENT_URL}?`.length);
    const hashIndex = queryString.indexOf('&vnp_SecureHash=');
    const signedPart = queryString.slice(0, hashIndex);
    const sig = queryString.slice(hashIndex + '&vnp_SecureHash='.length);
    const expected = createHmac('sha512', HASH_SECRET).update(signedPart).digest('hex');
    expect(sig).toBe(expected);
  });

  it('sorts keys alphabetically — vnp_Amount before vnp_Command', () => {
    const url = buildPaymentUrl({
      tmnCode: TMN_CODE,
      hashSecret: HASH_SECRET,
      paymentUrl: PAYMENT_URL,
      txnRef: 'pay_abc',
      amount: 100,
      orderInfo: 'x',
      returnUrl: RETURN_URL,
      ipAddress: '127.0.0.1',
      createDate: '20260521120000',
    });
    const query = url.slice(`${PAYMENT_URL}?`.length);
    expect(query.indexOf('vnp_Amount=')).toBeLessThan(query.indexOf('vnp_Command='));
    expect(query.indexOf('vnp_Command=')).toBeLessThan(query.indexOf('vnp_CurrCode='));
  });
});

describe('verifyIpnSignature', () => {
  function sign(params: Record<string, string>): string {
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(params[k] ?? '').replace(/%20/g, '+')}`)
      .join('&');
    return createHmac('sha512', HASH_SECRET).update(canonical).digest('hex');
  }

  const ipnPayload = {
    vnp_Amount: '50000000',
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: 'Rent 2026-05',
    vnp_ResponseCode: '00',
    vnp_TmnCode: TMN_CODE,
    vnp_TransactionNo: '14242427',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: 'pay_abc',
    vnp_PayDate: '20260521120500',
  };

  it('returns true on a valid signature', () => {
    const params = { ...ipnPayload, vnp_SecureHash: sign(ipnPayload) };
    expect(verifyIpnSignature(params, HASH_SECRET)).toBe(true);
  });

  it('returns true when the hash digest is uppercased', () => {
    const hash = sign(ipnPayload).toUpperCase();
    const params = { ...ipnPayload, vnp_SecureHash: hash };
    expect(verifyIpnSignature(params, HASH_SECRET)).toBe(true);
  });

  it('returns false on a tampered amount', () => {
    const params = {
      ...ipnPayload,
      vnp_Amount: '99999999',
      vnp_SecureHash: sign(ipnPayload),
    };
    expect(verifyIpnSignature(params, HASH_SECRET)).toBe(false);
  });

  it('returns false when the hash is missing', () => {
    expect(verifyIpnSignature(ipnPayload, HASH_SECRET)).toBe(false);
  });

  it('ignores vnp_SecureHashType when signing', () => {
    const params = {
      ...ipnPayload,
      vnp_SecureHashType: 'SHA512',
      vnp_SecureHash: sign(ipnPayload),
    };
    expect(verifyIpnSignature(params, HASH_SECRET)).toBe(true);
  });
});
