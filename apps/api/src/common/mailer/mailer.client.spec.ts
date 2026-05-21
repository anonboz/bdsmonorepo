import { afterEach, describe, expect, it, vi } from 'vitest';

// Hoisted so it runs *before* the `mailer.client` import below — that
// module reads `env.API_DISABLE_MAILER` at `getMailer()` time, but the
// env loader runs once at import. Setting process.env here is the
// cheapest way to flip the singleton's choice for these tests without
// mocking the env module.
vi.hoisted(() => {
  process.env.API_DISABLE_MAILER = 'true';
});

import {
  getMailer,
  readStubMessages,
  resetMailerForTests,
  selectBackend,
} from './mailer.client.js';
import { renderMagicLinkTemplate, renderOtpTemplate } from './templates.js';

afterEach(() => {
  resetMailerForTests();
});

describe('selectBackend', () => {
  it('picks stub when API_DISABLE_MAILER is true (even with keys set)', () => {
    expect(
      selectBackend({
        API_DISABLE_MAILER: true,
        RESEND_API_KEY: 're_test',
        SMTP_HOST: 'localhost',
      }),
    ).toBe('stub');
  });

  it('picks resend when the key is set and disable flag is off', () => {
    expect(
      selectBackend({
        API_DISABLE_MAILER: false,
        RESEND_API_KEY: 're_test',
        SMTP_HOST: 'localhost',
      }),
    ).toBe('resend');
  });

  it('picks smtp when only SMTP_HOST is set', () => {
    expect(
      selectBackend({
        API_DISABLE_MAILER: false,
        SMTP_HOST: 'localhost',
      }),
    ).toBe('smtp');
  });

  it('falls back to stub when nothing is configured', () => {
    expect(selectBackend({ API_DISABLE_MAILER: false })).toBe('stub');
  });
});

describe('stub backend (active when API_DISABLE_MAILER=true)', () => {
  it('captures sent messages so tests can assert them', async () => {
    const send = getMailer();
    await send({
      to: 'tenant@example.com',
      subject: 'Hello',
      html: '<p>Hi.</p>',
      text: 'Hi.',
    });
    const captured = readStubMessages();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      to: 'tenant@example.com',
      subject: 'Hello',
    });
  });

  it('returns a delivery descriptor with the stub provider tag', async () => {
    const send = getMailer();
    const delivery = await send({
      to: 't@example.com',
      subject: 's',
      html: '<p>x</p>',
    });
    expect(delivery.provider).toBe('stub');
    expect(delivery.providerId).toBeNull();
    expect(delivery.sentAt).toBeInstanceOf(Date);
  });
});

describe('templates', () => {
  it('renderOtpTemplate puts the code in the subject + body', () => {
    const t = renderOtpTemplate({ otp: '123456', type: 'sign-in' });
    expect(t.subject).toContain('123456');
    expect(t.html).toContain('123456');
    expect(t.text).toContain('123456');
    expect(t.html).toContain('sign in');
  });

  it('renderOtpTemplate adjusts copy for email-verification', () => {
    const t = renderOtpTemplate({ otp: '999', type: 'email-verification' });
    expect(t.html).toContain('verify your email');
  });

  it('renderMagicLinkTemplate inlines + escapes the link', () => {
    const t = renderMagicLinkTemplate({
      url: 'https://app.example.com/?t=abc&sig=def',
    });
    expect(t.text).toContain('https://app.example.com/?t=abc&sig=def');
    // The escaped HTML has the `&` rewritten to `&amp;` in both
    // the anchor href and the visible fallback.
    expect(t.html).toContain('&amp;sig=def');
  });

  it('templates HTML-escape user-controlled content', () => {
    const t = renderOtpTemplate({
      otp: '<script>alert("xss")</script>',
      type: 'sign-in',
    });
    expect(t.html).not.toContain('<script>');
    expect(t.html).toContain('&lt;script&gt;');
  });
});
