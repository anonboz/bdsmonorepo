import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  buildPaymentUrl,
  buildRefundBody,
  formatVnpayDate,
  parseVnpayDate,
  verifyIpnSignature,
} from './vnpay.client.js';

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

describe('parseVnpayDate', () => {
  it('round-trips with formatVnpayDate at the same wall clock', () => {
    const utc = new Date('2026-05-20T07:30:00Z');
    // Asia/Ho_Chi_Minh: 14:30 same day.
    expect(formatVnpayDate(utc)).toBe('20260520143000');
    expect(parseVnpayDate('20260520143000')?.toISOString()).toBe(utc.toISOString());
  });

  it('returns null for empty / null / malformed input', () => {
    expect(parseVnpayDate(null)).toBeNull();
    expect(parseVnpayDate(undefined)).toBeNull();
    expect(parseVnpayDate('')).toBeNull();
    expect(parseVnpayDate('not a date')).toBeNull();
    expect(parseVnpayDate('2026-05-20')).toBeNull();
  });
});

describe('buildRefundBody', () => {
  it('signs the canonical pipe-separated string in the documented field order', () => {
    const body = buildRefundBody({
      tmnCode: TMN_CODE,
      hashSecret: HASH_SECRET,
      requestId: 'req_001',
      txnRef: 'pay_abc',
      amount: 500_000,
      transactionType: '02',
      transactionNo: '14242427',
      transactionDate: '20260520143000',
      orderInfo: 'Refund: duplicate booking',
      createBy: 'owner_1',
      ipAddress: '203.0.113.1',
      createDate: '20260522120000',
    });

    // Field set + values.
    expect(body.vnp_RequestId).toBe('req_001');
    expect(body.vnp_Version).toBe('2.1.0');
    expect(body.vnp_Command).toBe('refund');
    expect(body.vnp_TransactionType).toBe('02');
    expect(body.vnp_Amount).toBe('50000000'); // *100
    expect(body.vnp_TransactionNo).toBe('14242427');
    expect(body.vnp_TransactionDate).toBe('20260520143000');
    expect(body.vnp_CreateBy).toBe('owner_1');
    expect(body.vnp_SecureHash).toBeTruthy();

    // Signature: re-sign locally with the same canonical string and
    // compare. The format is fixed per VNPay's 2.1 refund docs:
    // pipe-separated fields, NOT alphabetical + URL-encoded.
    const canonical = [
      'req_001',
      '2.1.0',
      'refund',
      TMN_CODE,
      '02',
      'pay_abc',
      '50000000',
      '14242427',
      '20260520143000',
      'owner_1',
      '20260522120000',
      '203.0.113.1',
      'Refund: duplicate booking',
    ].join('|');
    const expected = createHmac('sha512', HASH_SECRET).update(canonical).digest('hex');
    expect(body.vnp_SecureHash).toBe(expected);
  });

  it('partial-refund variant sends transactionType=03', () => {
    const body = buildRefundBody({
      tmnCode: TMN_CODE,
      hashSecret: HASH_SECRET,
      requestId: 'req_002',
      txnRef: 'pay_abc',
      amount: 100_000,
      transactionType: '03',
      transactionNo: '14242427',
      transactionDate: '20260520143000',
      orderInfo: 'Partial refund',
      createBy: 'owner_1',
      ipAddress: '203.0.113.1',
      createDate: '20260522120000',
    });
    expect(body.vnp_TransactionType).toBe('03');
  });
});
