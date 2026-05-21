# Spec: Critical-flow Playwright suite (phase 6.2)

> Status: **implemented (suite not run against a local DB locally yet — CI will exercise it on first push; see §12)**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

6.1 scaffolded `apps/e2e` and proved auth login works end-to-end.
6.2 lights up the four critical flows the BUILD_PLAN calls out for
Phase 6 — billing, tickets, campaigns, and partner jobs — so we can
catch cross-module regressions before they ship. The suite stays
API-driven for the same reasons as 6.1: hermetic, fast, no flaky
selectors. UI-driven coverage can come later if needed.

This slice also extends the CI workflow so the suite runs on every
PR and push. The added minutes are justified now that there are
four real flows to cover.

## 2. User stories

- As a **reviewer**, I want CI to run the four critical flows end
  to end against a real Postgres + Redis on every PR.
- As a **developer**, I want one happy-path test per critical
  flow — failures point at the specific module, not a soup of
  cascading errors.
- As a **future contributor**, I want a `lib/api.ts` helper that
  hides the cookie / JSON dance so adding a new flow test is small.

## 3. Surfaces

| Surface            | File                                  | Notes                             |
| ------------------ | ------------------------------------- | --------------------------------- |
| API request helper | `apps/e2e/lib/api.ts`                 | Thin wrapper on Playwright `ctx`  |
| Bill flow          | `apps/e2e/tests/bills.spec.ts`        | Owner generates bill, tenant sees |
| Ticket flow        | `apps/e2e/tests/tickets.spec.ts`      | Raise → resolve → rate            |
| Campaign flow      | `apps/e2e/tests/campaigns.spec.ts`    | Submit → approve → apply → accept |
| Partner job flow   | `apps/e2e/tests/partner-jobs.spec.ts` | Book → quote → start → complete   |
| CI integration     | `.github/workflows/ci.yml`            | New `e2e` job after `ci`          |

No new app code — these are tests that exercise existing endpoints.

## 4. API surface used

Every endpoint hit is already shipped. The suite verifies they
compose correctly across modules.

| Flow            | Endpoints (chain)                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **bill**        | POST `/v1/houses`, POST `/v1/houses/:h/units`, POST `/v1/houses/:h/units/:u/leases`, POST `…/leases/:l/transitions {to:ACTIVE}`, POST `…/leases/:l/bills/generate-now`, GET `/v1/me/bills` (as tenant) |
| **ticket**      | POST `/v1/me/tickets`, POST `/v1/me/owner-tickets/:id/transitions` ×3, POST `/v1/me/leases/:l/ratings`                                                                                                 |
| **campaign**    | POST `/v1/houses/:h/units/:u/campaigns`, POST `…/transitions {to:PENDING}`, POST `/v1/admin/campaigns/:id/approve`, POST `/v1/me/applications`, POST `…/applications/:id/accept`                       |
| **partner job** | POST `/v1/me/services` (partner), POST `/v1/me/service-jobs` (owner), POST `…/quote`, `…/accept`, `…/start`, `…/complete`, POST `…/rating` ×2                                                          |

## 5. Data model

None — all reads / writes go through Prisma indirectly via the API.

## 6. Workers / jobs

Not exercised in this slice. Bill / payout / campaign sweepers run
on cron and stay out of e2e. 6.5 (k6 load) and a future "sweeper
contract" test can poke them directly.

## 7. Test harness

### 7.1 `lib/api.ts`

```ts
export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  dispose(): Promise<void>;
}

export async function loginAs(key: TestUserKey): Promise<ApiClient & { userId: string }>;
```

Throws on non-2xx and includes status + body in the message so a
failure points at the offending step rather than a generic
"undefined is not a function" further down the chain.

### 7.2 `bills.spec.ts`

1. Login as owner.
2. POST a fresh house + a single unit.
3. POST a DRAFT lease tying the unit to `e2e.tenant`. `startDate =
today - 30d` so MOVE_IN is open immediately (matters for the
   ticket flow's rating step; here it's harmless).
4. Transition the lease to `ACTIVE`.
5. POST `…/bills/generate-now` with `periodStart` / `periodEnd`
   spanning the current month. Assert one bill comes back,
   `status: ISSUED`, with at least one RENT line totaling the
   lease's `rentAmount`.
6. Re-POST `generate-now` for the same period — assert
   `status: 'idempotent'` (the `(leaseId, idempotencyKey)` unique
   constraint short-circuits).
7. Login as tenant. GET `/v1/me/bills` — assert the bill is in the
   list with the expected total.

   **Note:** there's no "mark paid" endpoint in v1; full payment
   end-to-end waits for Phase 6 payment providers. The flow as
   shipped exercises generation, idempotency, and tenant visibility.

### 7.3 `tickets.spec.ts`

1. Login as owner; build a house + unit + ACTIVE lease tied to
   tenant (same fixture pattern as bills).
2. Login as tenant. POST `/v1/me/tickets` with `{ leaseId,
category: 'REPAIR', title, body }`. Assert `status: OPEN`.
3. Login as owner. Walk the ticket through `ACKNOWLEDGED →
IN_PROGRESS → RESOLVED` via three POSTs to
   `/v1/me/owner-tickets/:id/transitions`.
4. Login as tenant. GET `/v1/me/leases/:l/rating-state` — assert
   MOVE_IN is `isOpen: true`. POST a rating
   `{ milestone: MOVE_IN, score: 5, comment }`. Re-POST → 409
   `ratings.already_given`.

### 7.4 `campaigns.spec.ts`

1. Login as owner; build a fresh house + a VACANT unit.
2. POST a campaign on the unit. Assert `status: DRAFT`.
3. Transition `DRAFT → PENDING`.
4. Login as admin. POST `/v1/admin/campaigns/:id/approve` →
   campaign is `LIVE` with `publishedAt`.
5. Login as tenant. POST `/v1/me/applications` with the
   campaign id.
6. Login as owner. POST `/v1/houses/:h/units/:u/campaigns/:c/applications/:a/accept`
   with a lease body. Assert the response carries `createdLeaseId`
   and the campaign flips to `CLOSED`.

### 7.5 `partner-jobs.spec.ts`

1. Login as partner. POST `/v1/me/services` with name + basePrice.
2. Login as owner. POST `/v1/me/service-jobs` with `{ partnerId
(from /v1/partners), serviceId, description }`. Assert
   `status: REQUESTED`.
3. Login as partner. POST `…/quote {amount, currency}`. Owner
   POST `…/accept`. Partner POST `…/start`. Partner POST
   `…/complete {finalAmount, proofPhotos: []}`.
4. Verify three ledger rows minted via partner GET `/v1/me/payouts`
   (one HELD PAYOUT row) and owner GET `/v1/me/charges` (one
   CHARGE row with negative amount).
5. Owner POST `…/rating {score: 5}`. Partner POST `…/rating
{score: 4}`. GET ratings on both sides — both directions filled.

### 7.6 Test isolation

Tests don't reuse the seeded houses / units / leases — each
constructs its own scenario as the relevant role. They DO reuse
the four seeded users (admin / owner / tenant / partner) so the
suite doesn't have to bootstrap signup before every test.

The single shared worker handles the `auth.login` audit row
accumulation cleanly; tests don't depend on each other's audit
state.

## 8. CI integration

A new `e2e` job in `.github/workflows/ci.yml`:

- Depends on the existing `ci` job (so unit tests + typecheck go
  first; if those fail e2e is skipped).
- Uses the same `postgres:16-alpine` and `redis:7-alpine`
  services already declared on the main job.
- `DATABASE_URL=postgresql://app:app@localhost:5432/app_test`
  matches what the main job uses — `localhost` clears the
  loopback safety belt.
- Steps: checkout → setup pnpm + node → install → install
  Chromium → `pnpm prisma migrate deploy` (matches the dev path,
  avoids the interactive prompt) → `pnpm test:e2e`.
- Uploads `playwright-report/` and `test-results/` as artifacts
  on failure so the trace + screenshots are diff-able from the
  PR check.

`API_PUBLIC_URL`, `AUTH_SECRET`, `REDIS_URL`, `API_CORS_ORIGINS`
all get set inline in the job env block. The api `webServer` in
`playwright.config.ts` boots the API; `reuseExistingServer: false`
in CI guarantees a fresh process.

## 9. Edge cases

- **Better-auth `useSecureCookies` in production** — covered by
  the env: `NODE_ENV=test`, not `production`, so cookies are
  written `Secure: false` and Playwright stores them on plain
  HTTP.
- **`bills/generate-now` outside the lease's active window** —
  the service throws; tests pin `periodStart` to today.
- **Campaign moderation race** — `admin.approve` is the only
  way out of `PENDING`; only one admin in the seed avoids
  contention.
- **Service-job currency** — partner sets it via quote; e2e
  passes `VND`.
- **MOVE_IN rating closed** — tests set `startDate` in the past.

## 10. Out of scope

- **UI / browser driving** — pure API for now. UI tests can land
  if a UI regression bites us.
- **Refunds / payment provider integration** — Phase 6.5+.
- **Mark-paid endpoint** — doesn't exist; bill flow proves
  generation only.
- **Sweepers** — separate slice.
- **Negative-path coverage** — handled by unit tests; e2e stays
  green-path.

## 11. Acceptance criteria

- [x] Four new spec files under `apps/e2e/tests/`, one per flow.
- [x] Each spec is a single `test(…)` that drives the full happy
      path API-only.
- [x] `lib/api.ts` exposes a `loginAs(role)` returning a typed
      JSON client.
- [x] `pnpm turbo typecheck lint` clean.
- [x] `.github/workflows/ci.yml` runs the suite on every PR /
      main push and uploads artifacts on failure.

## 12. Manual test plan

1. `docker compose up -d postgres redis`.
2. `pnpm --filter @repo/e2e exec playwright install chromium`.
3. `DATABASE_URL=postgresql://app:app@localhost:5432/app pnpm test:e2e`.
4. All five tests pass (4 new + the 4 auth tests from 6.1 still
   pass).
5. Confirm the seeded users + per-test houses are present in the
   DB.

## 13. Rollout

- Test-only; no migrations.
- No flag.
- CI minutes: estimated +60s on a cold run.
- Comms: dev changelog — "e2e suite covers the four critical
  flows; CI runs them on every push."
