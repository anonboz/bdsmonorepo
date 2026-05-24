# Spec: User-scoped locale persistence (phase 11.2)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 11.1 shipped the i18n infrastructure but the user's chosen
language only persisted in a cookie. That works for the four PWAs in
isolation but two cracks appear the moment a user has more than one
device:

- **Logging in on a new browser** drops them back to whatever the
  `Accept-Language` header negotiates — usually `vi`, but never
  necessarily the language the user chose three months ago on their
  phone.
- **Email + push notifications** (Phase 11.5) can't read a per-device
  cookie. They need a server-side answer to "what language does this
  user want?"

  11.2 makes `User.locale` the source of truth, with the cookie kept in
  lock-step so the cheap-fast path (cookie-only server read on every
  request) keeps working.

## 2. User stories

- As a **returning user** who flipped to English last quarter, I sign
  in on a fresh browser and the app loads in English — not Vietnamese
  — without me touching the locale switcher.
- As a **new signup** who picked English on the marketing page before
  creating an account, my preference is preserved through signup —
  the `User.locale` row is `en` from the start, not `vi`-with-a-cookie.
- As an **email recipient**, the bill-paid notification (when 11.5
  ships) will render in my preferred language regardless of what
  browser fires the trigger.

## 3. Surfaces

| Surface         | App / file                                          | Notes                                                                      |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| DB column       | `User.locale VARCHAR(8) NOT NULL DEFAULT 'vi'`      | New migration `20260524080000_user_locale`.                                |
| Shared enum     | `packages/shared/src/enums/locale.ts`               | Mirror of `@repo/i18n`'s locale set + the `LOCALE_COOKIE` constant.        |
| Shared schema   | `packages/shared/src/schemas/auth.ts`               | `sessionUserSchema.locale` + new `meUpdateInputSchema`.                    |
| API guard       | `apps/api/src/auth/guards/auth.guard.ts`            | Selects + returns the column on every authenticated request.               |
| API endpoint    | `apps/api/src/auth/me.controller.ts` `PATCH /v1/me` | Updates `User.locale`, audits, stamps `bds-locale` cookie on the response. |
| Signup hook     | `apps/api/src/auth/better-auth.config.ts`           | `databaseHooks.user.create.after` reads cookie via `AsyncLocalStorage`.    |
| Locale switcher | `packages/i18n/src/components/locale-switcher.tsx`  | Accepts optional `onSave` so PWAs can wire the server save before reload.  |

## 4. Data model

```prisma
model User {
  // ...
  locale String @default("vi") @db.VarChar(8)
  // ...
}
```

Migration: `20260524080000_user_locale/migration.sql`. Forward-only
`ALTER TABLE` with `DEFAULT 'vi'`, so every existing row backfills
without a separate step.

The column is **not** an enum on the DB side — using `VARCHAR(8)`
keeps adding a future locale a `@repo/i18n` change rather than a
Prisma migration. The Zod layer narrows reads to the canonical set
(`vi` | `en`); anything outside that falls back to `defaultLocale`
defensively (`apps/api/src/auth/guards/auth.guard.ts`).

## 5. API

### `PATCH /v1/me`

Authenticated, all roles. Body validated via `meUpdateInputSchema`:

```ts
const meUpdateInputSchema = z
  .object({
    locale: localeSchema.optional(),
  })
  .refine((v) => v.locale !== undefined, {
    message: 'At least one field must be provided.',
  });
```

Behaviour:

- If `locale` matches the user's current value: no DB write, no audit
  row, but the `bds-locale` cookie is still set on the response.
  Keeps a stale-cookie scenario self-healing.
- If `locale` differs: a single Prisma transaction updates
  `User.locale` and writes a `user.locale.update` audit row with
  `{ from, to }`.
- Response: the standard `MeResponse` with the post-update `user`.
- Cookie: `bds-locale=<new>; Path=/; Max-Age=31536000; SameSite=Lax`
  (plus `Secure` in production). Same shape as the cookie the
  middleware writes — server-rendered translations stay in sync next
  request.

### `GET /v1/me`

Existing endpoint, now returns `user.locale` alongside the other
session fields.

## 6. Signup-time stamp

Better-Auth's `databaseHooks.user.create.after` only receives the
freshly-inserted user — no request context. We bridge it with a tiny
`AsyncLocalStorage`:

1. `AuthController` (the `/v1/auth/*` forwarder) reads the `bds-locale`
   cookie via `@fastify/cookie`'s parsed `req.cookies`, narrows it via
   `localeSchema.safeParse`, and wraps the `auth.handler(...)` call in
   `runWithLocale(cookieLocale, ...)`.
2. `databaseHooks.user.create.after` calls `getCookieLocale()`; when
   non-null, it issues a `prisma.user.update({ where: { id }, data: { locale } })`
   before the next hook runs.
3. The existing `user.signup` audit row gains a `locale` field in
   `meta` so support can answer "what language did this user pick at
   signup" without a join.

The update is unconditional (vs. comparing to `user.locale`) because
Better-Auth's `User` type doesn't know about our custom column — and
writing the same value back is cheap.

## 7. Locale switcher

`@repo/i18n`'s `LocaleSwitcher` gained an optional `onSave` prop:

```ts
export interface LocaleSwitcherProps {
  current: Locale;
  className?: string;
  onSave?: (locale: Locale) => Promise<void> | void;
}
```

Per-PWA wiring (lands in 11.3 / 11.4 alongside the actual chrome):

```tsx
<LocaleSwitcher
  current={session?.user.locale ?? defaultLocale}
  onSave={session ? (locale) => api.patch('/v1/me', { locale }) : undefined}
/>
```

When `onSave` is omitted (public marketing pages, pre-login screens)
the switcher only flips the cookie — exactly the 11.1 behaviour. When
present, it's awaited before the page reload so the server-side render
on the next paint reads the just-updated DB row through the cookie.

## 8. Edge cases

- **`onSave` throws** (network blip, 5xx): the cookie is already set
  so the next render still shows the chosen language; the DB row stays
  on the old value until the user retries. Acceptable v1 — surfacing
  a toast is owner of the per-app wiring (11.3 / 11.4).
- **Stale cookie value (`de`)**: AuthGuard's `localeSchema.safeParse`
  drops it back to `defaultLocale` in the response — the actual
  `User.locale` column stays whatever it was.
- **Pre-login user flips locale, then signs up**: the cookie is on
  the request that hits `/v1/auth/sign-in/...`; AuthController seeds
  the AsyncLocalStorage; the signup hook stamps `User.locale`. Verified
  via `locale-context.spec.ts`.
- **Pre-login user with no cookie at all**: `getCookieLocale()` returns
  `null`, the hook is a no-op, the DB default (`vi`) wins. Exactly
  what we want for users who land on a Vietnamese-locale page and
  never touch the switcher.

## 9. Out of scope

- **Locale-aware notification templates.** Phase 11.5. The column
  exists for that worker to read; no wiring yet.
- **SMS OTP locale.** Phase 11.6 picks the SMS provider; this slice
  doesn't wire its language selection.
- **`Accept-Language` precedence after login.** A logged-in user's
  `User.locale` already populates the cookie via PATCH /me, so the
  middleware never needs to look at the header for them. We don't
  inject locale on every authenticated server response — that's
  pessimistic for cookie-set users — but if a user-server cookie
  drift ever shows up in metrics we can layer a `Set-Cookie` on `/me`
  GETs as a follow-up.
- **Profile fields beyond locale.** `meUpdateInputSchema` is set up
  to grow (displayName, image), but the API only ships locale today.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `PATCH /v1/me { "locale": "en" }` updates `User.locale`, sets
      the `bds-locale` cookie on the response, writes a
      `user.locale.update` audit row.
- [ ] `PATCH /v1/me { "locale": "vi" }` against a user already on
      `vi` returns 200 with no audit row written.
- [ ] `GET /v1/me` returns `user.locale`.
- [ ] A signup flow with an `en` cookie produces a `User.locale = 'en'`
      row and a `user.signup` audit row whose `meta.locale = 'en'`.
- [ ] A signup flow with no cookie produces a `User.locale = 'vi'`
      row.
- [ ] `LocaleSwitcher` calls the supplied `onSave` callback before
      reloading; when no callback is supplied it only sets the cookie
      (11.1 behaviour preserved).

## 11. Manual test plan

1. Run `pnpm db:migrate:dev` (or fresh `prisma migrate deploy`) to
   pick up the new column.
2. `pnpm turbo dev`.
3. Sign in as a tenant. Hit `GET /v1/me` — confirm `user.locale = 'vi'`.
4. `PATCH /v1/me` with `{ "locale": "en" }`. Confirm:
   - response carries `user.locale = 'en'`,
   - `Set-Cookie: bds-locale=en` is on the response,
   - `AuditLog` has a `user.locale.update` row tied to the user.
5. Sign out and clear cookies. Set `bds-locale=en` manually before
   the OTP/magic-link sign-in for a fresh email. Confirm after
   signup that `User.locale = 'en'` in the DB.
6. Sign out and clear cookies (no `bds-locale`). Sign up a new email.
   Confirm `User.locale = 'vi'`.

## 12. Rollout

- One forward-only migration (`20260524080000_user_locale`); fully
  backfills via `DEFAULT 'vi'` at `ALTER TABLE` time.
- No new env vars.
- No feature flag — the column + endpoint are invisible to users
  until 11.3 / 11.4 wires the switcher into per-PWA chrome.
- Backwards-compatible: pre-11.2 clients ignore the new `user.locale`
  field in `GET /v1/me` responses (TS / Zod schemas in the four PWAs
  are updated in lockstep here, but the wire shape stays additive).
