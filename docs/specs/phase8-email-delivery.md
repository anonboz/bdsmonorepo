# Spec: Email delivery wiring (phase 8.1)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

For six phases better-auth has been logging OTP codes to stdout:

```ts
async sendVerificationOTP({ email, otp, type }) {
  console.log(`[auth] OTP (${type}) for ${email}: ${otp}`);
}
```

Workable in dev, not workable for a real user. Phase 8.1 wires
**actual email sending** so the OTP lands in an inbox.

We resolve the BUILD_PLAN §8 open decision on "OTP transport
provider" in favour of **email-only via Resend**, with an SMTP
fallback that targets MailHog in local dev. SMS is deferred — no
clear provider for VN and not blocking real users.

The new `MailerService` is also the foundation for **8.2**
(domain-event → notification fanout): every bill / payment /
ticket / job / payout state transition that needs to email
someone will go through this service.

## 2. User stories

- As a **tenant** logging in for the first time, my OTP arrives
  by email within seconds — not buried in the API logs.
- As a **developer** running `pnpm dev` + `docker compose up`, OTP
  emails land in MailHog at `localhost:8025` automatically — no
  Resend key required to develop.
- As an **operator**, when `RESEND_API_KEY` is set in production
  the API switches to Resend without any other config.
- As a **future caller** in 8.2, I import `MailerService` from a
  global Nest module and call `send({ to, subject, html })` —
  one shape, three backends.

## 3. Surfaces

| Surface             | App / file                                     | Notes                                 |
| ------------------- | ---------------------------------------------- | ------------------------------------- |
| Mailer client       | `apps/api/src/common/mailer/mailer.client.ts`  | Backend selection + singleton         |
| Mailer service      | `apps/api/src/common/mailer/mailer.service.ts` | NestJS-DI wrapper                     |
| Mailer module       | `apps/api/src/common/mailer/mailer.module.ts`  | `@Global()` so any module can inject  |
| Templates           | `apps/api/src/common/mailer/templates.ts`      | OTP + magic-link inline HTML (small)  |
| Better-auth wire-up | `apps/api/src/auth/better-auth.config.ts`      | Replaces the console.log placeholders |

No UI changes; everything is server-side.

## 4. Backend selection

`MailerService` dispatches by env, in order:

| Order | Env condition                    | Backend                          | Failure mode                          |
| ----- | -------------------------------- | -------------------------------- | ------------------------------------- |
| 1     | `RESEND_API_KEY` set             | Resend SDK (`emails.send`)       | API error → throws; caller decides    |
| 2     | `SMTP_HOST` reachable            | nodemailer over SMTP             | SMTP error → throws; caller decides   |
| 3     | else (`API_DISABLE_MAILER=true`) | In-memory stub (logs + captures) | Always succeeds; tests assert capture |

The dev defaults already point `SMTP_HOST=localhost` + `SMTP_PORT=1025`
which is MailHog's default. So `pnpm dev` + `docker compose up`
silently uses MailHog without any extra config.

When neither backend is configured AND `API_DISABLE_MAILER` isn't
set, the stub is used and a warning logs once at boot — that's
the explicit "running headless" mode for CI / unit tests.

`API_DISABLE_MAILER=true` is the explicit override that forces
the stub regardless of other env. The e2e CI block + the existing
tests set it.

## 5. Mailer interface

```ts
// apps/api/src/common/mailer/mailer.client.ts
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailDelivery {
  provider: 'resend' | 'smtp' | 'stub';
  /** Provider-side message id when available (Resend) or message-id header (SMTP). */
  providerId: string | null;
  sentAt: Date;
}

export function getMailer(): (message: MailMessage) => Promise<MailDelivery>;
```

```ts
// apps/api/src/common/mailer/mailer.service.ts
@Injectable()
export class MailerService {
  send(message: MailMessage): Promise<MailDelivery>;
  /** True when the singleton resolves to a real (non-stub) backend. */
  isLive(): boolean;
}
```

Stub backend captures sent messages into a module-level array
that tests + the future notification spec can inspect via
`readSentMessages()` (test-only helper, not exported from the
module barrel).

## 6. Better-auth integration

Replace the two `console.log` placeholders. The `MailerService`
isn't available in the better-auth config scope (it runs outside
Nest DI, same as Prisma), so we call `getMailer()` directly there
— same pattern Prisma uses in `writeAuthAudit`.

```ts
plugins: [
  emailOTP({
    otpLength: 6,
    expiresIn: 60 * 10,
    async sendVerificationOTP({ email, otp, type }) {
      const mailer = getMailer();
      const { subject, html, text } = renderOtpTemplate({ otp, type });
      await mailer({ to: email, subject, html, text });
    },
  }),
  magicLink({
    expiresIn: 60 * 10,
    async sendMagicLink({ email, url }) {
      const mailer = getMailer();
      const { subject, html, text } = renderMagicLinkTemplate({ url });
      await mailer({ to: email, subject, html, text });
    },
  }),
],
```

`renderOtpTemplate` + `renderMagicLinkTemplate` live in
`templates.ts` — minimal inline HTML, no framework. 8.2 may
extract a shared header / footer when more templates land.

## 7. Templates (v1)

Tiny inline HTML, no images, no CSS framework. The OTP is the
hero number; the magic link is the only button.

```ts
function renderOtpTemplate({ otp, type }) {
  return {
    subject: `Your verification code: ${otp}`,
    text:
      `Your code is ${otp}. It expires in 10 minutes.\n` +
      `If you didn't request this, ignore this email.`,
    html: `…`, // a centered single column with the OTP large + the boilerplate
  };
}
```

The `type` param from better-auth (`sign-in` / `email-verification`)
adjusts the subject line slightly.

## 8. Env additions

| Var                  | Required | Default          | Notes                                        |
| -------------------- | -------- | ---------------- | -------------------------------------------- |
| `RESEND_API_KEY`     | no       | unset            | Already declared. When set, used as primary. |
| `EMAIL_FROM`         | no       | already defaults | Used as `From:` for every send.              |
| `SMTP_HOST`          | no       | `localhost`      | Already declared. MailHog by default.        |
| `SMTP_PORT`          | no       | `1025`           | Already declared.                            |
| `API_DISABLE_MAILER` | no       | `false`          | **New.** Forces the stub backend.            |

No new secrets need to be wired for the existing default to keep
working in dev (MailHog).

## 9. Resend specifics

- The `from` address must be on a domain verified in the Resend
  dashboard. Until production deploy, dev uses MailHog and prod
  uses Resend with the configured `EMAIL_FROM`.
- Resend's `emails.send` returns `{ data: { id }, error? }`. We
  treat any `error` as a thrown — better-auth's emailOTP plugin
  wraps the throw and returns a 500 to the client, which our
  ProblemFilter converts to `common.internal_error`. Tenant
  retries; ops sees the Sentry capture.

## 10. Edge cases

- **Resend rate-limited (429)** — surfaced as a Resend error → we
  throw → 500. Acceptable for v1; a future slice can add a queue +
  retry in the BullMQ `notifications.send` worker (8.2).
- **MailHog not running** — nodemailer throws `ECONNREFUSED`. The
  better-auth send fails → 500. Dev workflow needs MailHog up,
  same as before (docker compose handled this).
- **Bad `EMAIL_FROM`** — Resend rejects with a clear error; SMTP
  may accept it depending on the server. Documented in §11.
- **Multiple `to` addresses** — `to` is a single string in v1;
  Resend supports arrays but no caller needs it yet.
- **Cold start, both env vars set** — Resend wins per the order
  in §4. Use unset Resend key on staging when you want SMTP.

## 11. Out of scope

- **SMS** — no provider chosen. The §8 open decision lands at
  "email-only via Resend; SMS deferred."
- **Web push** — service-worker push API; later slice.
- **Bounce / complaint webhooks** — Resend supports this; we'll
  wire when transactional volume justifies it.
- **HTML templates with images / branding** — minimal v1.
- **Tracking pixels / read receipts** — out by default.
- **Async delivery via BullMQ** — 8.2 wraps `send()` in a queue
  job for non-OTP messages. OTPs stay synchronous (the tenant
  is waiting on them).

## 12. Acceptance criteria

- [x] `resend` + `nodemailer` packages added to `apps/api`.
- [x] `apps/api/src/common/mailer/` exports `MailerService` +
      `getMailer()` with backend selection per §4.
- [x] `MailerModule` is `@Global()` so any future module can
      inject `MailerService`.
- [x] `better-auth.config.ts` calls `getMailer()` for OTP +
      magic-link delivery; no more `console.log`.
- [x] Stub backend backs `API_DISABLE_MAILER=true` and is
      readable from tests via a `readSentMessages()` helper.
- [x] Unit tests cover the three branches of backend selection + the better-auth integration.
- [x] `pnpm turbo typecheck lint test` clean.

## 13. Manual test plan

1. `docker compose up -d postgres redis mailhog`.
2. `pnpm --filter @repo/api dev`.
3. Login as any seeded user → enter email → server sends OTP
   via SMTP.
4. Open MailHog at `http://localhost:8025` → see the email
   with the OTP.
5. Set `RESEND_API_KEY` + restart → OTP arrives in the inbox
   matching the from-address domain.
6. Set `API_DISABLE_MAILER=true` + restart → OTP path returns
   200 without contacting MailHog (stub captured it).

## 14. Rollout

- No migration.
- `EMAIL_FROM` populated per environment via the secrets
  manager (the existing default works for dev).
- Resend dashboard requires the from-domain verification before
  the first production send.
- Comms: dev changelog — "OTP + magic-link emails actually send;
  Resend in prod, MailHog in dev, stub for tests."
