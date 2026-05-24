# Spec: SMS OTP via Vietnamese gateway (phase 11.6)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Email is the only sign-in factor across the platform. Vietnamese tenants
typically use a phone number as their primary identifier and many do not
read their personal email regularly — relying on email-only OTP gates a
huge chunk of the target audience behind a friction step they may not be
able to complete on their phone.

11.6 adds SMS OTP as a peer of email OTP: the same 6-digit code, the
same 10-minute window, the same rate limits. Tenant login grows an
email ↔ phone toggle; the other PWAs stay email-only for now (operators,
landlords, and partners already have working email accounts that they
use for the rest of the back-office workflow). The hooks land
identically on every PWA — copy-pasting the toggle into owner / partner
later is a 50-line PR.

The provider is **esms.vn** (Speedio). VN-local provider, brand-name
support, OTP-tier pricing.

## 2. User stories

- As a **tenant in Vietnam** without a personal email account, I can
  sign in with my phone number and a 6-digit code sent by SMS.
- As a **tenant on Vietnamese**, the SMS body is in Vietnamese; on
  English the body is in English. (Sourced from the visitor's
  `bds-locale` cookie at request time, same path as 11.5.)
- As an **abuse target**, I cannot be flooded with paid SMS because the
  send-OTP endpoint is rate-limited at 5/minute per IP (mirror of the
  email-OTP send limit).
- As an **operator on a dev box**, I can run the whole auth flow
  without paid SMS — the default `SMS_PROVIDER=mock` captures messages
  in an in-memory inbox and logs them to stdout (mirror of MailHog for
  email).

## 3. Surfaces

| Surface         | App / file                                                   | Notes                                                                                                             |
| --------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Sender plumbing | `apps/api/src/common/sms/sms.client.ts`                      | `selectSmsBackend`, `getSmsSender` (cached singleton), stub backend with `readStubSmsMessages` for tests.         |
| Nest service    | `apps/api/src/common/sms/sms.service.ts`                     | Thin DI wrapper over `getSmsSender()`; logs + rethrows on failure.                                                |
| Templates       | `apps/api/src/common/sms/otp-templates.ts`                   | `renderSmsOtpBody({code, locale})` — ≤160 chars, vi default, en fallback.                                         |
| Better-auth     | `apps/api/src/auth/better-auth.config.ts`                    | `phoneNumber()` plugin with `sendOTP` wired to `getSmsSender()`. `signUpOnVerification` on for phone-only signup. |
| Env             | `apps/api/src/env.ts`                                        | `SMS_PROVIDER`, `ESMS_VN_API_KEY`, `ESMS_VN_SECRET_KEY`, `ESMS_VN_BRAND_NAME`, `ESMS_VN_API_URL`.                 |
| Rate limit      | `apps/api/src/main.ts`                                       | 5/min on `/v1/auth/phone-number/send-otp`, 10/min on `/verify`.                                                   |
| Tenant UI       | `apps/tenant/app/login/login-form.tsx`                       | Email ↔ phone tab toggle in the request step; phone path posts to the phone-number endpoints.                     |
| i18n            | `packages/i18n/src/messages/{en,vi}/tenant.json`             | `tenant.login.form.tabEmail`, `tabPhone`, `phoneLabel`, `phoneDescription` + `codeSentTo` placeholder renamed.    |
| Tests           | `apps/api/src/common/sms/{sms.client,otp-templates}.spec.ts` | 13 unit tests covering selector, esms.vn POST shape, error paths, stub inbox, locale-aware body rendering.        |

## 4. Provider interface

```ts
type SmsMessage = { to: string; body: string };
type SmsDelivery = { provider: string; providerId?: string; sentAt: Date };
type SmsSender = (msg: SmsMessage) => Promise<SmsDelivery>;
```

`selectSmsBackend(env)` is pure — returns `'esms-vn'` when
`SMS_PROVIDER=esms-vn` **and** the credentials are present; otherwise
`'mock'`. Misconfigured esms-vn downgrades to mock with a console
warning (the alternative — hard-failing at boot — kills `pnpm turbo dev`
on every contributor box that hasn't set the keys).

`getSmsSender()` is a cached singleton (mirror of
`getMailer()` in 11.5) — `selectSmsBackend` runs once at first call;
the returned function is reused for every subsequent send. Tests reset
the cache with `resetSmsForTests()`.

## 5. esms.vn HTTP shape

```
POST  https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/
Content-Type: application/json

{
  "ApiKey":     "<env>",
  "SecretKey":  "<env>",
  "Phone":      "+84901234567",
  "Content":    "Mã xác minh BDS của bạn là 123456. ...",
  "SmsType":    2,           // 2 = brand-name SMS, 8 = no brand
  "Brandname":  "BDS",       // omitted when no brand configured
  "IsUnicode":  0
}
```

Success is `CodeResult === '100'`. The `SMSID` is captured into
`SmsDelivery.providerId` so it can be reconciled against the esms.vn
delivery report later if needed. Non-100 codes throw with the raw code
in the message so Sentry shows which esms.vn error you hit.

## 6. Better-auth wiring

The `phoneNumber` plugin from `better-auth/plugins` (1.6.11) handles
the actual OTP storage + verification. We supply:

- `otpLength: 6` / `expiresIn: 600` / `allowedAttempts: 3` — mirror the
  email-otp settings.
- `phoneNumberValidator: /^\+?[1-9]\d{6,14}$/.test(raw)` — same regex
  as `phoneSchema` in `@repo/shared`. (Plugin contract is `boolean`,
  not a Zod schema.)
- `sendOTP: async ({phoneNumber, code}) => send({to, body: render(code, locale)})` —
  `locale` comes from `getCookieLocale()` (the AsyncLocalStorage seeded
  in 11.2's `AuthController`), so a visitor who set Vietnamese in the
  switcher before requesting the code gets a Vietnamese body.
- `signUpOnVerification.getTempEmail: phone => phone+${strip+}@bds.local` —
  better-auth requires an email per User row even for phone-only signup;
  this is a stable derivation that won't collide with real emails. The
  user can attach a real email later via the (future) account flow.

### Field mapping

Better-auth's plugin expects columns named `phoneNumber` +
`phoneNumberVerified`; the existing schema has `phone` + `phoneVerified`
(Phase 1.1). Rather than migrate, we map at the better-auth-config
level:

```ts
user: {
  fields: {
    name: 'displayName',          // pre-existing
    phoneNumber: 'phone',         // 11.6
    phoneNumberVerified: 'phoneVerified',
  },
}
```

No migration ships with 11.6.

## 7. Rate limits

Per-route, mirror of the email-OTP limits added in 3.x:

| Route                                 | Max / window | Why                                   |
| ------------------------------------- | ------------ | ------------------------------------- |
| `POST /v1/auth/phone-number/send-otp` | 5 / 1 min    | The expensive (paid) call.            |
| `POST /v1/auth/phone-number/verify`   | 10 / 1 min   | Cheap; capped to deter brute-forcing. |

Identical keys to the email path means a determined attacker can't
pivot from "email-rate-limited" to "phone-flood" via the same IP.

## 8. Tenant login UI

The request step grows a two-tab toggle (`Email` / `Phone`) above the
input field. Choosing a tab changes:

- The input's label, type, and inputMode (`email` ↔ `tel`).
- The endpoint hit on submit
  (`/v1/auth/email-otp/send-verification-otp` ↔ `/v1/auth/phone-number/send-otp`).

The verify step is identical visually for both modes — it remembers
which mode initiated the flow and posts to the matching `/sign-in/email-otp`
or `/phone-number/verify` route.

The `codeSentTo` translation placeholder was renamed from `{email}` to
`{identifier}` so the same string serves both modes; only one caller
existed.

## 9. Out of scope

- **Owner / partner / admin login UI.** The backend is fully ready;
  copying the toggle into each PWA is a follow-up PR per app. Operators
  - landlords primarily use email today.
- **Phone-only signup via tenant marketing screens.** The verify flow
  will mint a User row + session if the phone is new (better-auth's
  `signUpOnVerification`); no separate sign-up screen yet.
- **SMS for the notifications system** (e.g. "bill issued" via SMS).
  11.5 covers email + push only. Adding SMS notifications would re-use
  `SmsService` but lives in a different phase.
- **Phone number change / unlink flow.** A user who signs in by phone
  is stuck with that number until we add a profile screen for it.
- **Cost-cap circuit-breaker.** Per-IP rate-limit is the only guard;
  a global daily ceiling would be a Phase 12 ops addition.
- **Number portability normalization.** We store whatever E.164 string
  the user typed; we don't run libphonenumber to canonicalize across
  national formats.

## 10. Edge cases

- **Stub mode in tests / dev**: every send lands in `stubInbox` and
  logs to stdout. `readStubSmsMessages()` is the test hook.
- **esms.vn 5xx**: HTTP errors throw; better-auth surfaces the failure
  to the client as a 500. The user can retry; rate-limit allows it.
- **Unknown locale on the cookie**: `renderSmsOtpBody` falls back to
  `vi` via the same `locale === 'en' ? 'en' : 'vi'` pattern used in
  11.5's notification templates.
- **Phone collides with an existing email-only account**: better-auth
  treats them as separate users (we don't merge by phone). A future
  account-linking flow would address it.

## 11. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `selectSmsBackend` returns `'mock'` by default and `'esms-vn'`
      only when both `SMS_PROVIDER=esms-vn` and the API/secret keys
      are present.
- [ ] `esmsVnSender` POSTs the documented JSON shape, treats
      `CodeResult !== '100'` as a failure, and propagates non-2xx HTTP.
- [ ] `renderSmsOtpBody` returns Vietnamese by default, English for
      `'en'`, ≤160 chars in both cases, and embeds the supplied code.
- [ ] Rate limits 5/min on send-otp and 10/min on verify enforced via
      the route-config hook in `main.ts`.
- [ ] Tenant login form renders an email ↔ phone toggle and dispatches
      to the matching endpoint pair based on the selected mode.

## 12. Manual test plan

1. `SMS_PROVIDER=mock` (default): start the API, open tenant `/login`,
   choose Phone, enter `+84901234567`, press Send. Observe the stubbed
   body in the API stdout. Enter the code; you sign in.
2. Flip the locale-switcher to English, repeat the request; the stubbed
   body is in English.
3. Set `SMS_PROVIDER=esms-vn` with real keys; repeat step 1 on a
   test phone you own. The SMS arrives within seconds; entering the
   code signs in.
4. Send 6 OTPs back-to-back from one IP — the 6th request 429s with
   `application/problem+json`.
5. Sign in by phone with a brand-new number; confirm a User row was
   minted with a `phone+<digits>@bds.local` temp email.

## 13. Rollout

- **No DB migration.** The plugin reuses the existing `phone` +
  `phoneVerified` columns via the field mapping in §6.
- **Env vars** — `SMS_PROVIDER` defaults to `mock`; production must
  set it to `esms-vn` and supply `ESMS_VN_API_KEY`,
  `ESMS_VN_SECRET_KEY`, and (recommended) `ESMS_VN_BRAND_NAME`.
- **No feature flag.** The tenant toggle is visible immediately; the
  phone path silently no-ops in dev / staging until esms-vn keys land
  (stub mode logs to stdout).
- **Other PWAs** — owner / partner / admin login screens stay
  email-only for now. The backend pieces are shared, so adding the
  same toggle to each app is a UI-only follow-up PR (≤50 LoC).
