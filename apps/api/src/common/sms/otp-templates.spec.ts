import { describe, expect, it } from 'vitest';

import { renderSmsOtpBody } from './otp-templates.js';

describe('renderSmsOtpBody', () => {
  it('defaults to Vietnamese when no locale is supplied', () => {
    expect(renderSmsOtpBody({ code: '123456' })).toContain('Mã xác minh BDS');
  });

  it('uses English when locale=en', () => {
    expect(renderSmsOtpBody({ code: '123456', locale: 'en' })).toContain(
      'Your BDS verification code',
    );
  });

  it('embeds the supplied code verbatim', () => {
    expect(renderSmsOtpBody({ code: '987654', locale: 'en' })).toContain('987654');
  });

  it('treats unknown locales as Vietnamese', () => {
    // Cast simulates a stale row / hand-mutated cookie carrying a
    // locale outside the canonical set.
    expect(renderSmsOtpBody({ code: '111111', locale: 'de' as 'en' })).toContain('Mã xác minh');
  });

  it('stays under the 160-char OTP-tier cap for both locales', () => {
    expect(renderSmsOtpBody({ code: '123456', locale: 'en' }).length).toBeLessThanOrEqual(160);
    expect(renderSmsOtpBody({ code: '123456', locale: 'vi' }).length).toBeLessThanOrEqual(160);
  });
});
