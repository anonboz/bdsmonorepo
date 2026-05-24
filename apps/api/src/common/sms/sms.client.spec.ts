import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  esmsVnSender,
  readStubSmsMessages,
  resetSmsForTests,
  selectSmsBackend,
} from './sms.client.js';

describe('selectSmsBackend', () => {
  it('returns mock when SMS_PROVIDER=mock', () => {
    expect(
      selectSmsBackend({
        SMS_PROVIDER: 'mock',
        ESMS_VN_API_URL: 'https://example.com',
      }),
    ).toBe('mock');
  });

  it('returns esms-vn when fully configured', () => {
    expect(
      selectSmsBackend({
        SMS_PROVIDER: 'esms-vn',
        ESMS_VN_API_KEY: 'k',
        ESMS_VN_SECRET_KEY: 's',
        ESMS_VN_API_URL: 'https://example.com',
      }),
    ).toBe('esms-vn');
  });

  it('downgrades to mock when esms-vn requested but credentials missing', () => {
    expect(
      selectSmsBackend({
        SMS_PROVIDER: 'esms-vn',
        ESMS_VN_API_URL: 'https://example.com',
      }),
    ).toBe('mock');
  });
});

describe('esmsVnSender', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the expected JSON shape with brandname when configured', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ CodeResult: '100', SMSID: 'sms_42' }),
    });
    const send = esmsVnSender({
      apiKey: 'k',
      secretKey: 's',
      brandName: 'BDS',
      apiUrl: 'https://test/esms',
    });
    const result = await send({ to: '+84901234567', body: 'hi' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(call[0]).toBe('https://test/esms');
    expect(call[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body).toMatchObject({
      ApiKey: 'k',
      SecretKey: 's',
      Phone: '+84901234567',
      Content: 'hi',
      SmsType: 2,
      Brandname: 'BDS',
      IsUnicode: 0,
    });
    expect(result).toMatchObject({ provider: 'esms-vn', providerId: 'sms_42' });
  });

  it('omits Brandname + uses SmsType=8 when no brandname configured', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ CodeResult: '100' }),
    });
    const send = esmsVnSender({
      apiKey: 'k',
      secretKey: 's',
      brandName: undefined,
      apiUrl: 'https://test/esms',
    });
    await send({ to: '+84901234567', body: 'hi' });
    const call = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(call[1].body) as Record<string, unknown>;
    expect(body.SmsType).toBe(8);
    expect(body).not.toHaveProperty('Brandname');
  });

  it('throws on non-100 CodeResult', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ CodeResult: '101' }),
    });
    const send = esmsVnSender({
      apiKey: 'k',
      secretKey: 's',
      brandName: 'BDS',
      apiUrl: 'https://test/esms',
    });
    await expect(send({ to: '+84901234567', body: 'hi' })).rejects.toThrow(/CodeResult=101/);
  });

  it('throws on non-2xx HTTP', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('upstream down'),
    });
    const send = esmsVnSender({
      apiKey: 'k',
      secretKey: 's',
      brandName: 'BDS',
      apiUrl: 'https://test/esms',
    });
    await expect(send({ to: '+84901234567', body: 'hi' })).rejects.toThrow(/HTTP 503/);
  });
});

describe('stub sms backend', () => {
  beforeEach(() => {
    resetSmsForTests();
  });

  it('captures sends into the in-memory inbox readable from tests', async () => {
    // Force the selector via env snapshot — getSmsSender wires off
    // the live env, so we just import the stub indirectly via the
    // public API and read the inbox.
    const { getSmsSender } = await import('./sms.client.js');
    const send = getSmsSender();
    await send({ to: '+84901234567', body: 'hello' });
    expect(readStubSmsMessages()).toEqual([{ to: '+84901234567', body: 'hello' }]);
  });
});
