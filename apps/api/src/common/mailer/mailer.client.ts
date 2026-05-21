import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import { Resend } from 'resend';

import { env } from '../../env.js';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailDelivery {
  provider: 'resend' | 'smtp' | 'stub';
  /** Provider message id (Resend) or RFC 2822 Message-ID header (SMTP). */
  providerId: string | null;
  sentAt: Date;
}

export type MailSender = (message: MailMessage) => Promise<MailDelivery>;

/**
 * Module-level capture of every message the stub backend sent. Tests
 * read this via {@link readStubMessages}; production code never does.
 * Reset between test cases via {@link resetMailerForTests}.
 */
const stubInbox: MailMessage[] = [];

let cachedSender: MailSender | null = null;
let cachedBackend: 'resend' | 'smtp' | 'stub' | null = null;
let warnedHeadless = false;

/**
 * Pure backend selector — tests pin the env snapshot directly. The
 * runtime caller ({@link getMailer}) feeds the live env values in.
 *
 *   1. `API_DISABLE_MAILER=true` → stub.
 *   2. `RESEND_API_KEY` set      → Resend.
 *   3. `SMTP_HOST` set           → nodemailer SMTP (defaults to
 *                                   MailHog at localhost:1025).
 *   4. else                      → stub.
 */
export function selectBackend(envSnapshot: {
  API_DISABLE_MAILER: boolean;
  RESEND_API_KEY?: string;
  SMTP_HOST?: string;
}): 'resend' | 'smtp' | 'stub' {
  if (envSnapshot.API_DISABLE_MAILER) return 'stub';
  if (envSnapshot.RESEND_API_KEY) return 'resend';
  if (envSnapshot.SMTP_HOST) return 'smtp';
  return 'stub';
}

/**
 * Returns the singleton mail-sender chosen at boot per
 * {@link selectBackend}. Cached after the first call; tests should
 * use {@link resetMailerForTests} between cases.
 *
 * Called from anywhere — better-auth, NestJS services, future
 * notification workers.
 */
export function getMailer(): MailSender {
  if (cachedSender) return cachedSender;

  const backend = selectBackend({
    API_DISABLE_MAILER: env.API_DISABLE_MAILER,
    RESEND_API_KEY: env.RESEND_API_KEY,
    SMTP_HOST: env.SMTP_HOST,
  });
  cachedBackend = backend;
  if (backend === 'resend') {
    // selectBackend only returns 'resend' when the key is set; the
    // `!` here is for the type checker.
    cachedSender = resendSender(env.RESEND_API_KEY!);
  } else if (backend === 'smtp') {
    cachedSender = smtpSender();
  } else {
    if (!env.API_DISABLE_MAILER && !env.RESEND_API_KEY && !env.SMTP_HOST && !warnedHeadless) {
      console.warn(
        '[mailer] running headless — neither RESEND_API_KEY nor SMTP_HOST is set; emails go nowhere.',
      );
      warnedHeadless = true;
    }
    cachedSender = stubSender;
  }
  return cachedSender;
}

export function currentMailerBackend(): 'resend' | 'smtp' | 'stub' | null {
  return cachedBackend;
}

/** True iff the active backend actually delivers (Resend / SMTP). */
export function isMailerLive(): boolean {
  // Resolve lazily so callers don't have to.
  getMailer();
  return cachedBackend === 'resend' || cachedBackend === 'smtp';
}

/** Test helper. Reads, does not clear; pair with {@link resetMailerForTests}. */
export function readStubMessages(): readonly MailMessage[] {
  return stubInbox;
}

/** Test helper. Drops the singleton + clears the stub inbox. */
export function resetMailerForTests(): void {
  cachedSender = null;
  cachedBackend = null;
  warnedHeadless = false;
  stubInbox.length = 0;
}

// ---- backends --------------------------------------------------------

function resendSender(apiKey: string): MailSender {
  const client = new Resend(apiKey);
  return async (m) => {
    const res = await client.emails.send({
      from: env.EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    if (res.error) {
      throw new Error(`Resend send failed: ${res.error.name}: ${res.error.message}`);
    }
    return {
      provider: 'resend',
      providerId: res.data?.id ?? null,
      sentAt: new Date(),
    };
  };
}

function smtpSender(): MailSender {
  let transporter: Transporter | null = null;
  return async (m) => {
    transporter ??= createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // MailHog has no auth; treat as plaintext-friendly. Real SMTP
      // servers should provide a TLS-enabled host + creds; not v1.
      secure: false,
      ignoreTLS: true,
    });
    const opts: SendMailOptions = {
      from: env.EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    };
    const info = (await transporter.sendMail(opts)) as { messageId?: string };
    return {
      provider: 'smtp',
      providerId: info.messageId ?? null,
      sentAt: new Date(),
    };
  };
}

const stubSender: MailSender = (m) => {
  stubInbox.push(m);
  return Promise.resolve({
    provider: 'stub',
    providerId: null,
    sentAt: new Date(),
  });
};
