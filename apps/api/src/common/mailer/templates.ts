/**
 * Minimal inline HTML for the OTP + magic-link emails. No external
 * CSS, no images, no framework — passes every spam filter and
 * renders consistently across clients. Phase 8.2's notification
 * fanout will extract a shared header / footer when more templates
 * land.
 */

interface OtpInput {
  otp: string;
  /** better-auth passes `sign-in` / `email-verification` / etc. */
  type: string;
}

interface MagicLinkInput {
  url: string;
}

export function renderOtpTemplate(input: OtpInput): {
  subject: string;
  html: string;
  text: string;
} {
  const verb = input.type === 'sign-in' ? 'sign in' : 'verify your email';
  return {
    subject: `Your verification code: ${input.otp}`,
    text: `Your code to ${verb} is ${input.otp}.\n\nIt expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: htmlShell(
      `Verification code`,
      `
      <p style="${pStyle}">Your code to ${escape(verb)} is:</p>
      <p style="font-size:32px;font-weight:600;letter-spacing:6px;text-align:center;margin:24px 0;">${escape(
        input.otp,
      )}</p>
      <p style="${pMuted}">It expires in 10 minutes. If you didn&apos;t request this, you can safely ignore this email.</p>
    `,
    ),
  };
}

export function renderMagicLinkTemplate(input: MagicLinkInput): {
  subject: string;
  html: string;
  text: string;
} {
  return {
    subject: 'Your sign-in link',
    text: `Click the link to sign in:\n${input.url}\n\nThe link expires in 10 minutes. If you didn't request this, you can safely ignore this email.`,
    html: htmlShell(
      `Sign in`,
      `
      <p style="${pStyle}">Click the button below to sign in. The link expires in 10 minutes.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${escape(input.url)}" style="display:inline-block;padding:12px 20px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
          Sign in
        </a>
      </p>
      <p style="${pMuted}">If the button doesn&apos;t work, paste this link into your browser:<br><span style="word-break:break-all;color:#475569;">${escape(input.url)}</span></p>
      <p style="${pMuted}">If you didn&apos;t request this, you can safely ignore this email.</p>
    `,
    ),
  };
}

// ---- styling helpers ------------------------------------------------

const pStyle = 'font-size:14px;line-height:1.5;color:#0f172a;margin:0 0 12px;';
const pMuted = 'font-size:13px;line-height:1.5;color:#64748b;margin:0 0 8px;';

function htmlShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;">
    ${body}
  </div>
</body></html>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
