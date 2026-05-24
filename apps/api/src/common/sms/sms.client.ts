import { type SmsDelivery, type SmsMessage, type SmsSender } from './sms.types.js';
import { env } from '../../env.js';

/**
 * Phase 11.6 — boot-time picker for the SMS sender. Mirrors
 * `mailer.client.ts`: pure selector + cached singleton, with a stub
 * inbox for tests + dev.
 *
 *   1. `SMS_PROVIDER='mock'`     → in-memory stub.
 *   2. `SMS_PROVIDER='esms-vn'`  → POSTs to esms.vn's JSON API.
 *
 * The selector intentionally accepts an env snapshot so tests can pin
 * a configuration without monkey-patching `process.env`.
 */

const stubInbox: SmsMessage[] = [];

let cachedSender: SmsSender | null = null;
let cachedBackend: 'mock' | 'esms-vn' | null = null;
let warnedHeadless = false;

export interface SmsEnvSnapshot {
  SMS_PROVIDER: 'mock' | 'esms-vn';
  ESMS_VN_API_KEY?: string;
  ESMS_VN_SECRET_KEY?: string;
  ESMS_VN_BRAND_NAME?: string;
  ESMS_VN_API_URL: string;
}

export function selectSmsBackend(envSnapshot: SmsEnvSnapshot): 'mock' | 'esms-vn' {
  if (envSnapshot.SMS_PROVIDER === 'esms-vn') {
    if (!envSnapshot.ESMS_VN_API_KEY || !envSnapshot.ESMS_VN_SECRET_KEY) {
      // Misconfigured: pick the stub so the API still boots. The
      // healthcheck won't catch this, but a single OTP send will log
      // loudly via `warnedHeadless` below.
      return 'mock';
    }
    return 'esms-vn';
  }
  return 'mock';
}

export function getSmsSender(): SmsSender {
  if (cachedSender) return cachedSender;

  const backend = selectSmsBackend({
    SMS_PROVIDER: env.SMS_PROVIDER,
    ESMS_VN_API_KEY: env.ESMS_VN_API_KEY,
    ESMS_VN_SECRET_KEY: env.ESMS_VN_SECRET_KEY,
    ESMS_VN_BRAND_NAME: env.ESMS_VN_BRAND_NAME,
    ESMS_VN_API_URL: env.ESMS_VN_API_URL,
  });
  cachedBackend = backend;

  if (backend === 'esms-vn') {
    cachedSender = esmsVnSender({
      apiKey: env.ESMS_VN_API_KEY!,
      secretKey: env.ESMS_VN_SECRET_KEY!,
      brandName: env.ESMS_VN_BRAND_NAME,
      apiUrl: env.ESMS_VN_API_URL,
    });
  } else {
    if (env.SMS_PROVIDER === 'esms-vn' && !warnedHeadless) {
      console.warn(
        '[sms] SMS_PROVIDER=esms-vn requested but ESMS_VN_API_KEY/SECRET_KEY missing — falling back to the stub backend; OTPs will not be delivered.',
      );
      warnedHeadless = true;
    }
    cachedSender = stubSender;
  }
  return cachedSender;
}

export function currentSmsBackend(): 'mock' | 'esms-vn' | null {
  return cachedBackend;
}

/** True iff the active backend actually delivers (esms-vn). */
export function isSmsLive(): boolean {
  getSmsSender();
  return cachedBackend === 'esms-vn';
}

/** Test helper. Reads, does not clear; pair with {@link resetSmsForTests}. */
export function readStubSmsMessages(): readonly SmsMessage[] {
  return stubInbox;
}

/** Test helper. Drops the singleton + clears the stub inbox. */
export function resetSmsForTests(): void {
  cachedSender = null;
  cachedBackend = null;
  warnedHeadless = false;
  stubInbox.length = 0;
}

// ---- backends ---------------------------------------------------------

const stubSender: SmsSender = (m) => {
  stubInbox.push(m);
  // Log so devs without a real provider can copy the OTP out of the
  // API console. Body is short and explicit so this stays useful.
  // eslint-disable-next-line no-console
  console.log(`[sms:stub] → ${m.to}: ${m.body}`);
  return Promise.resolve({
    provider: 'mock',
    providerId: null,
    sentAt: new Date(),
  } satisfies SmsDelivery);
};

interface EsmsVnConfig {
  apiKey: string;
  secretKey: string;
  brandName: string | undefined;
  apiUrl: string;
}

/**
 * esms.vn `SendMultipleMessage_V4_post_json` POST body shape.
 *
 *   - `SmsType=2` is the OTP-priority type (highest priority,
 *     restricted to 160 chars, cheapest OTP-tier billing).
 *   - `SmsType=8` is a non-brandname fallback for accounts without
 *     a registered brandname.
 *   - `Brandname` is the registered sender name; required when
 *     `SmsType=2` and accepted when sending from an OTP-eligible
 *     account.
 */
export function esmsVnSender(config: EsmsVnConfig): SmsSender {
  return async (m) => {
    const useBrand = Boolean(config.brandName);
    const body = {
      ApiKey: config.apiKey,
      SecretKey: config.secretKey,
      Phone: m.to,
      Content: m.body,
      SmsType: useBrand ? 2 : 8,
      ...(useBrand && { Brandname: config.brandName }),
      IsUnicode: 0,
    };
    const res = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`esms.vn HTTP ${res.status}: ${await res.text()}`);
    }
    const payload = (await res.json()) as { CodeResult?: string; SMSID?: string };
    // esms.vn returns CodeResult="100" on success; anything else is
    // an error (101 = bad credentials, 102 = bad phone, 103 = insufficient
    // balance, 104 = bad ApiKey, 118 = SmsType invalid for account, …).
    if (payload.CodeResult !== '100') {
      throw new Error(`esms.vn rejected send: CodeResult=${payload.CodeResult ?? '(missing)'}`);
    }
    return {
      provider: 'esms-vn',
      providerId: payload.SMSID ?? null,
      sentAt: new Date(),
    } satisfies SmsDelivery;
  };
}
