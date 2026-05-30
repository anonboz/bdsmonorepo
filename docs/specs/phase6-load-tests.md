# Spec: k6 load tests (phase 6.7)

> Status: **implemented (payment + webhook scripts deferred to Phase 7; see §9)**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

BUILD*PLAN §6 item 2 calls for "Load test payment + webhook paths
with k6 (target: 95p < 500ms at 50 rps)." The literal target is
ahead of itself — payment and webhook endpoints don't exist yet
(they ship in Phase 7+ with Stripe / VNPay). What we \_can* do
today is establish the load-test harness, baseline the API at
the target rps on the routes that exist, and leave a script
template for payment + webhook scripts to drop into when those
endpoints land.

The scripts also double as a regression check: when a future PR
slows down the partner listing or the OTP path, running k6 catches
it before users notice.

## 2. User stories

- As a **release engineer**, I want a one-command k6 run that
  hits the 50 rps / 500 ms target and tells me if we're under
  the threshold.
- As a **reviewer** of a perf-touching PR, I want to fire the
  load test from GitHub Actions and link the artifact in the PR.
- As a **new engineer**, I want a runbook entry explaining how
  to read the k6 summary so I don't have to learn k6 from scratch.

## 3. Surfaces

| Surface           | File                              | Notes                                                     |
| ----------------- | --------------------------------- | --------------------------------------------------------- |
| Smoke test        | `load-tests/smoke.js`             | 1 VU × 10 s. Sanity that k6 + API are up.                 |
| Public reads load | `load-tests/public-reads.js`      | 50 rps × 2 min. Hits `/v1/public/campaigns` + `/healthz`. |
| Auth flow load    | `load-tests/auth-flow.js`         | 10 rps × 1 min. End-to-end OTP roundtrip.                 |
| Workflow          | `.github/workflows/load.yml`      | Manual `workflow_dispatch` only.                          |
| Runbook           | `docs/operations/load-testing.md` | How to run + interpret + when to fire it.                 |

No app code changes. No migrations.

## 4. Targets

Mirrors BUILD_PLAN §6 item 2.

| Script         | Throughput | Duration | Threshold                                            |
| -------------- | ---------- | -------- | ---------------------------------------------------- |
| `smoke`        | 1 VU       | 10 s     | All checks pass, no failed requests.                 |
| `public-reads` | 50 rps     | 2 min    | `http_req_duration` p95 < 500 ms; failure rate < 1%. |
| `auth-flow`    | 10 rps     | 1 min    | OTP roundtrip p95 < 800 ms; failure rate < 1%.       |

Targets are pinned with k6's `thresholds:` block so the run exits
non-zero on regression — CI / Actions surface that as a workflow
failure.

The original spec target (50 rps on payment + webhook) maps to
`public-reads` here for now; `auth-flow` carries a softer target
because it includes a database write (`Verification`) per request.

## 5. Why not load-test what we have under auth?

K6 runs JavaScript in a Go runtime — it can issue HTTP requests
with cookies, but it can't easily read from Postgres. Auth-gated
load tests need either:

- a pre-issued long-lived cookie (fine for owner/admin reads,
  brittle because sessions expire), or
- a setup phase that walks the OTP flow per VU (slow startup,
  but the `auth-flow` script does exactly this).

For v1 we keep load tests **per-flow**: the OTP roundtrip lives
in `auth-flow.js`, public reads stay public. When payment
endpoints land, their scripts will follow the `auth-flow`
pattern — log in once in `setup()`, share cookies via
`__ENV` / `init` context, then hammer the route.

## 6. Scripts

### 6.1 `smoke.js`

- `vus: 1`, `duration: '10s'`.
- Hits `/healthz`, `/v1/public/campaigns?limit=5`.
- Asserts status 200 and a known shape (`status === 'ok'`,
  `Array.isArray(items)`).
- Threshold: zero failed checks.

### 6.2 `public-reads.js`

- `scenarios.public_reads = { executor: 'constant-arrival-rate',
rate: 50, timeUnit: '1s', duration: '2m', preAllocatedVUs: 50 }`.
- Per VU iteration: GET `/v1/public/campaigns?limit=20`, then
  GET `/healthz`. 2 requests per iteration → ~100 rps total
  on the API. Adjust if the API can handle more.
- Thresholds:
  - `http_req_duration: ['p(95)<500']`
  - `http_req_failed: ['rate<0.01']`

### 6.3 `auth-flow.js`

- `scenarios.auth = { executor: 'constant-arrival-rate', rate: 10,
timeUnit: '1s', duration: '1m', preAllocatedVUs: 20 }`.
- Per iteration:
  1. POST `/v1/auth/email-otp/send-verification-otp`
     with a unique email per VU + iteration so we don't
     collide.
  2. Sleep 50 ms (simulates a user reading their inbox).
  3. POST `/v1/auth/sign-in/email-otp` with a known OTP.
     **NB:** the OTP is stored in `Verification` — k6 can't
     read it. For load purposes we POST a constant wrong
     OTP and accept the 401. The DB write + the
     better-auth logic + the rate-limit decision all
     execute, which is what we want to baseline.
- Thresholds:
  - `http_req_duration: ['p(95)<800']`
  - `http_req_failed{type:network}: ['rate<0.01']` —
    explicit "we don't care about 4xx, only network failures".

Setting `API_DISABLE_RATE_LIMIT=true` is required when running
this script — 10 rps blows through the 5/min per-IP send-otp
limit in ~30 s.

## 7. Workflow

`.github/workflows/load.yml`:

- `workflow_dispatch:` only — load tests cost minutes and aren't
  needed on every PR.
- Spins up Postgres 16 + Redis 7 services like the e2e job.
- Migrates the schema, then runs the API in the background with
  `API_DISABLE_QUEUES=true API_DISABLE_RATE_LIMIT=true`.
- Installs k6 from the official `grafana/k6` apt repo (or the
  pre-built binary).
- Runs each script in turn, uploading the summary JSON as a
  workflow artifact.
- Exits non-zero if any script's threshold fails.

The workflow doesn't run on `main` push — too expensive to gate
every merge on; the unit + e2e jobs catch most regressions.

## 8. Edge cases

- **API not running** — k6 fails fast on connection refused.
  The workflow's "boot the API" step uses
  `wait-on http://localhost:4001/healthz` so we don't race.
- **Rate-limit collision** — `auth-flow.js` requires
  `API_DISABLE_RATE_LIMIT=true`. The workflow sets it; running
  locally needs the same env.
- **Hot vs cold** — the first 5 s of a run is JIT warmup +
  Prisma client warm-up. We don't slice that out — it's part
  of the user experience.
- **Verification table bloat** — `auth-flow.js` creates a row
  per iteration. The cleanup tail of the workflow truncates
  `Verification` so the next run starts clean.

## 9. Out of scope

- **Payment + webhook scripts** — placeholders only. They drop
  in when Phase 7 ships the endpoints.
- **Production load tests** — these run against a local API.
  Hitting prod with 50 rps is a separate decision, gated on
  business hours + ops awareness.
- **Endurance / soak tests (hours / days)** — k6 can do them
  via long durations; out of scope for v1.
- **Distributed runs (k6 Cloud)** — single-machine 50 rps fits
  comfortably; no need.
- **Browser flow tests (k6-browser)** — Playwright covers that
  via the critical-flow suite (6.2).

## 10. Acceptance criteria

- [x] `load-tests/smoke.js`, `public-reads.js`, `auth-flow.js`
      exist and run with `k6 run`.
- [x] Thresholds pinned in each script match §4.
- [x] `.github/workflows/load.yml` runs all three on
      `workflow_dispatch` and uploads summary JSON artifacts.
- [x] `docs/operations/load-testing.md` documents how to run +
      interpret + when.
- [x] `pnpm turbo typecheck lint` clean (k6 scripts are .js,
      not under any TS package).

## 11. Manual test plan

1. `docker compose up -d postgres redis`.
2. `DATABASE_URL=postgresql://app:app@localhost:5432/app \
API_DISABLE_QUEUES=true API_DISABLE_RATE_LIMIT=true \
pnpm --filter @repo/api dev` — leave running.
3. `k6 run load-tests/smoke.js` — passes.
4. `k6 run load-tests/public-reads.js` — meets §4 thresholds.
5. `k6 run load-tests/auth-flow.js` — meets §4 thresholds.
6. From the GitHub UI: Actions → "Load tests" → Run workflow —
   green check, three artifacts.

## 12. Rollout

- New `load-tests/` directory; new workflow; new doc.
- No env changes required for the workflow (it sets its own).
- Comms: dev changelog — "k6 baseline tests live; fire via
  Actions → Load tests."
