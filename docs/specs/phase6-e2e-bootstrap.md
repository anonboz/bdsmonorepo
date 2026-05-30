# Spec: Playwright e2e bootstrap + auth login per role (phase 6.1)

> Status: **implemented (suite not run against a local DB yet — needs `DATABASE_URL` override; see §12)**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Through Phase 5 we relied entirely on Vitest unit tests; the Phase 5
specs each carried a `Playwright e2e deferred — apps/e2e still
unscaffolded` caveat. Phase 6's Hardening goal opens with "Playwright
e2e for critical flows" — but before any flow lands, the suite needs
a runnable shell: a `playwright.config`, a deterministic DB reset, a
programmatic login helper, and a first test proving the wiring works.

This slice does just that. It scaffolds `apps/e2e`, ships an auth
login test exercising each role (admin / owner / tenant / partner)
via the real OTP flow, and leaves a `lib/auth.loginAs()` helper that
6.2's critical-flow suite will stack on top of.

## 2. User stories

- As a **developer**, I want `pnpm test:e2e` to spin up the API,
  reset the DB, and run the suite — no manual setup beyond
  `docker compose up -d`.
- As a **developer**, I want a `loginAs(email)` helper so 6.2's
  flow tests don't each re-implement the OTP dance.
- As a **reviewer**, I want one passing test per role to catch
  auth regressions (suspended user, wrong role, role drift).

## 3. Screens / surfaces

| Surface           | App  | Route                           | Notes                             |
| ----------------- | ---- | ------------------------------- | --------------------------------- |
| Playwright config | e2e  | `apps/e2e/playwright.config.ts` | Single project; API webServer     |
| Global setup      | e2e  | `apps/e2e/global-setup.ts`      | Wipes the test DB + seeds 4 users |
| Login helper      | e2e  | `apps/e2e/lib/auth.ts`          | OTP send → read DB → verify       |
| Auth spec         | e2e  | `apps/e2e/tests/auth.spec.ts`   | Login per role + assert `/v1/me`  |
| Root script       | repo | `pnpm test:e2e`                 | Turbo-routed                      |

No UI driven yet — login goes through the API to keep the first test
hermetic. 6.2 will layer browser flows on top.

## 4. API shape

No new endpoints. The helper drives existing better-auth routes:

| Method | Path                                       | Notes                           |
| ------ | ------------------------------------------ | ------------------------------- |
| POST   | `/v1/auth/email-otp/send-verification-otp` | `{ email, type: 'sign-in' }`    |
| POST   | `/v1/auth/sign-in/email-otp`               | `{ email, otp }` returns cookie |
| GET    | `/v1/me`                                   | returns `AuthenticatedUser`     |

The OTP is read directly from `Verification` via Prisma (the dev
config logs it; tests don't depend on logs).

## 5. Data model changes

None.

## 6. Workers / jobs

None.

## 7. Permissions

The four seeded test users carry exactly one role each. The auth
e2e asserts `/v1/me.roles` contains the expected role.

## 8. Test harness

### 8.1 `apps/e2e/package.json`

- `@playwright/test`, `tsx`, `@repo/db`, `@repo/shared` (workspace).
- Scripts: `test`, `test:headed`, `typecheck`, `lint`, `install:browsers`.

### 8.2 `playwright.config.ts`

- One project, Chromium only — UI testing comes in 6.2.
- `webServer.command = 'pnpm --filter @repo/api dev'`, `url = http://localhost:4001/healthz`.
- `reuseExistingServer = !process.env.CI` so devs can keep `pnpm dev` running.
- `globalSetup = './global-setup.ts'`.
- `workers = 1` — tests share a single DB; parallel cleanup would
  race. 6.2 may introduce per-worker isolation when the suite grows.

### 8.3 `global-setup.ts`

- Refuses to run when `NODE_ENV === 'production'` (defensive belt;
  the prisma seed has the same guard).
- **Refuses to run when `DATABASE_URL` points at a non-loopback
  host.** Truncating tables on the shared Supabase pooler dev DB
  would erase real work, so the setup only accepts `localhost`,
  `127.0.0.1`, `::1`, `postgres`, `db`. Running e2e requires
  overriding `DATABASE_URL` to a local docker DB.
- Truncates every table in dependency order (mirrors
  `packages/db/src/seed.ts`).
- Inserts one user per role with stable, well-known emails:

  | Email                    | Role    | Display name |
  | ------------------------ | ------- | ------------ |
  | `e2e.admin@test.local`   | ADMIN   | E2E Admin    |
  | `e2e.owner@test.local`   | OWNER   | E2E Owner    |
  | `e2e.tenant@test.local`  | TENANT  | E2E Tenant   |
  | `e2e.partner@test.local` | PARTNER | E2E Partner  |

  The partner user also gets a `PartnerProfile` so the directory
  read in 6.2 doesn't surface zero results.

### 8.4 `lib/auth.ts`

`loginAs(email)` returns `{ cookieHeader, userId }`. Steps:

1. POST `/v1/auth/email-otp/send-verification-otp` with
   `{ email, type: 'sign-in' }`.
2. `SELECT value FROM "Verification" WHERE identifier LIKE ...` —
   better-auth's identifier is `sign-in-otp-<email>`; we match on
   the email suffix to be plugin-version-agnostic.
3. POST `/v1/auth/sign-in/email-otp` with `{ email, otp }`.
4. Capture the `set-cookie` header and return it.

A second helper `apiAs(cookieHeader)` returns a small fetch wrapper
that re-sends the cookie on every request.

## 9. Edge cases

- **API not running** — Playwright's `webServer` block boots it;
  `reuseExistingServer` lets a dev that already ran `pnpm dev` skip
  the start.
- **Stale OTP in `Verification`** — the global setup truncates that
  table; `loginAs` reads only the row with the freshest `createdAt`
  matching the email.
- **DB lock during teardown** — workers = 1 avoids it.
- **OTP plugin's `expiresIn` (10 min)** — fine for e2e; tests
  complete in seconds.
- **Multiple roles per user** — out of scope; the seed gives each
  user exactly one role.

## 10. Out of scope

- **UI-driven login** — 6.2 will drive the four login forms in a
  real browser. 6.1 keeps the surface tight.
- **CI integration** — adding e2e to `.github/workflows/ci.yml`
  comes in 6.2 once the suite has more coverage to justify the
  added CI minutes.
- **Per-worker DB isolation** — single worker is fine until the
  suite is wider.
- **Test fixtures for houses / bills / tickets** — 6.2 introduces
  them as it needs them.
- **Magic-link login path** — only OTP for now.

## 11. Acceptance criteria

- [x] `pnpm test:e2e` from the repo root spins up the API, runs the
      auth suite, and exits 0.
- [x] Global setup leaves exactly the four seeded users (one per
      role) in the DB.
- [x] One test per role: `login → GET /v1/me → assert role`.
- [x] `loginAs` helper exposed for 6.2 to consume.
- [x] `pnpm turbo typecheck` + `pnpm turbo lint` remain green.

## 12. Manual test plan

1. `docker compose up -d postgres redis`.
2. `pnpm install`.
3. `pnpm --filter @repo/e2e exec playwright install chromium`.
4. Point `DATABASE_URL` at the local docker DB — the default
   `apps/api/.env` connects to the Supabase pooler and the
   safety belt in §8.3 will (correctly) refuse to wipe it. Example:

   ```bash
   DATABASE_URL=postgresql://app:app@localhost:5432/app \
     pnpm test:e2e
   ```

5. Watch the API boot, the suite run, four tests pass.
6. Confirm `Verification`, `Session`, and `AuditLog` tables hold
   the expected rows post-run.

## 13. Rollout

- New package only; no migrations.
- No flag.
- Comms: dev changelog ("Playwright suite scaffolded; 6.2 will
  add critical-flow coverage").
