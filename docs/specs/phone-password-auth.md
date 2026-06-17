# Spec: Phone + password login

> Status: draft | **review** | approved | shipped
> _(All acceptance criteria implemented across PRs 1–4; awaiting human review — auth change.)_
> Phase: 12
> Owner: <human reviewer — auth change>
> Spec last updated: 2026-06-17

## 1. Why

Today every app logs in passwordlessly (email-OTP, magic-link, SMS-OTP). Users
who sign in frequently (owners on the road, partners on site) want a faster,
familiar **phone number + password** flow that doesn't depend on receiving an
SMS each time. This adds password sign-in **alongside** the existing OTP flows —
nothing is removed, and OTP remains the recovery path for anyone who hasn't set
a password (or forgets it).

## 2. User stories

- As any user, I want to sign in with my **phone number + password** so I don't
  have to wait for an OTP every time.
- As an existing OTP-only user, after I log in via OTP I want a **"set a
  password"** screen so I can opt into password login.
- As a user who never set a password, I want **OTP login to keep working**
  unchanged, with no lockout.

## 3. Screens / surfaces

| Surface                         | App                           | Route                    | Notes                                                                    |
| ------------------------------- | ----------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| Login — add "Use password" mode | admin, owner, tenant, partner | `/login`                 | Tab/toggle: "Code" (existing) vs "Password" (phone + password).          |
| Set-password screen             | admin, owner, tenant, partner | `/set-password` (authed) | Shown post-login when `hasPassword=false`; also reachable from settings. |

## 4. API shape

```ts
// @repo/shared/schemas/auth.ts (additions)
export const phonePasswordSignInSchema = z.object({
  phoneNumber: phoneSchema,
  password: z.string().min(8).max(128),
});

export const setPasswordSchema = z.object({
  newPassword: z.string().min(8).max(128),
});
```

Endpoints:

| Method | Path                            | Role(s) | Description                                                                                                                                      |
| ------ | ------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/v1/auth/sign-in/phone-number` | Public  | better-auth native (phoneNumber plugin) — `{ phoneNumber, password }`. Enabled by turning on the `emailAndPassword` credential provider.         |
| POST   | `/v1/me/set-password`           | authed  | Custom Nest endpoint → `auth.api.setPassword`. Sets a password for the session user (works when they have none). Audited as `auth.password.set`. |

`GET /v1/me` response gains `hasPassword: boolean` so clients know whether to
nudge the set-password screen.

## 5. Data model changes

**None.** `Account.password String?` and `User.phone String? @unique` already
exist in `packages/db/prisma/schema.prisma`. Passwords are stored by better-auth
in the `credential` Account row. No migration.

Migration name: _n/a_

## 6. Workers / jobs

None.

## 7. Permissions

No new roles. Sign-in is public; `set-password` requires an authenticated
session (global `AuthGuard`). The `RolesGuard` is unchanged — password login
yields the same session/roles as OTP login.

## 8. Edge cases

- **No password set** → `/sign-in/phone-number` returns 401 `auth.invalid_credentials`; UI points the user back to OTP login.
- **Brute force** → dedicated rate limit on `POST /v1/auth/sign-in/phone-number` (e.g. 10/min/IP) + better-auth's built-in attempt handling. Security-review item.
- **Phone enumeration** → identical error + timing for "no such phone" and "wrong password".
- **Unverified phone** → password sign-in allowed only if `phoneVerified` (phone was verified at some point via OTP); otherwise force OTP first.
- **Password reset for phone-only users** → out of scope v1; OTP login is the recovery path (then re-set password). Documented below.
- Enabling `emailAndPassword` must NOT open a public email+password signup — set `disableSignUp: true` and surface no email/password UI.

## 9. Out of scope

- Password **reset/forgot** flow (recovery is "log in via OTP, then set a new password"). A dedicated reset-via-phone-OTP flow is a follow-up.
- Email + password login (we keep password scoped to phone per product decision).
- Password strength meter / breach (HIBP) check — note as a hardening follow-up.

## 10. Acceptance criteria

- [x] `emailAndPassword` provider enabled with `disableSignUp: true`; no public email signup route usable. _(PR1)_
- [x] `POST /v1/auth/sign-in/phone-number` with `{ phoneNumber, password }` returns a session for a user who has set a password. _(PR1 — verified: 200 + session cookie)_
- [x] `POST /v1/me/set-password` sets a password for a session user with none; subsequent phone+password sign-in works. _(PR1 — verified: 204, then hasPassword=true)_
- [x] OTP + magic-link login unchanged for users without a password. _(PR1 — OTP login still 200)_
- [x] Dedicated rate limit on the phone-password sign-in route. _(PR1 — 10/min/IP)_
- [x] All 4 apps: login screen offers Code/Password modes; post-login set-password screen renders at 375px. _(PR2 owner, PR3 admin/tenant/partner. Tenant adds password as a 3rd tab beside email/phone OTP.)_
- [x] i18n strings added for en + vi across the apps. _(PR2/3 — owner/tenant/partner localized; admin is English-only inline per its CLAUDE.md.)_
- [x] One Playwright happy-path: set password → sign out → sign in with phone+password. _(PR4 — `apps/e2e/tests/auth-password.spec.ts`; needs the local docker DB to execute.)_
- [x] `pnpm turbo typecheck` + `lint` clean; unit test for the set-password service path. _(PR1 — api+shared typecheck/lint clean, 4 unit tests pass)_

## 11. Manual test plan

1. Log in to owner app via OTP (`owner1@example.com` / its phone `+14155550101`).
2. On the set-password screen, set `Passw0rd!23`.
3. Sign out. Choose "Password", enter phone `+14155550101` + `Passw0rd!23` → lands logged in.
4. Wrong password → friendly error, no lockout of OTP path.
5. A user who never set a password: password mode errors and suggests OTP; OTP still works.

## 12. Rollout

- Feature flag: `NEXT_PUBLIC_AUTH_PASSWORD_ENABLED` (default off) gates the UI mode per app so we can ship server-first, enable per-app.
- Migration order: none (no schema change). Deploy API (provider enabled) before flipping the client flag.
- Backfill: none — passwords are opt-in.
- Comms: in-app nudge on the set-password screen; no external comms needed.
