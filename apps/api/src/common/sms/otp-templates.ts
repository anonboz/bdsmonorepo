import { type Locale } from '@repo/shared';

/**
 * Phase 11.6 — single-string SMS body for the auth OTP. Kept short
 * because esms.vn's OTP-tier billing caps at 160 chars; longer bodies
 * either get split (more cost, possible delivery delay) or get
 * downgraded to a lower SMS type without brandname.
 *
 * Locale falls back to `vi` (the platform default) when an unknown
 * value lands here, matching the convention from phase 11.5's
 * notification renderers.
 */
export function renderSmsOtpBody(opts: { code: string; locale?: Locale }): string {
  if (opts.locale === 'en') {
    return `Your BDS verification code is ${opts.code}. Valid for 10 minutes. Do not share it with anyone.`;
  }
  return `Mã xác minh BDS của bạn là ${opts.code}. Có hiệu lực 10 phút. Không chia sẻ cho bất kỳ ai.`;
}
