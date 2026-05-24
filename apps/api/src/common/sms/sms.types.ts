/**
 * Phase 11.6 — pluggable SMS gateway interface. Every implementation
 * returns a {@link SmsDelivery} on success and throws on failure. The
 * better-auth `phoneNumber` plugin wraps the call so a throw surfaces
 * as a `4xx` on `/v1/auth/phone-number/send-otp`.
 */
export interface SmsMessage {
  /** E.164 phone number, e.g. `+84901234567`. */
  to: string;
  /** Plain text body. SMS is one-shot — no HTML, no subject. */
  body: string;
}

export interface SmsDelivery {
  /** Stable identifier of the chosen backend. */
  provider: 'mock' | 'esms-vn';
  /** Provider-side message id; null when the provider doesn't return one. */
  providerId: string | null;
  sentAt: Date;
}

export type SmsSender = (message: SmsMessage) => Promise<SmsDelivery>;
