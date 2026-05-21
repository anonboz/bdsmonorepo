# Spec: Observability — Sentry, metrics, uptime (phase 6.4)

> Status: **implemented (Next.js apps' Sentry init deferred — see §11)**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

The platform currently flies blind in production: a 500 in the API
goes nowhere, a stuck BullMQ queue piles silently, and "is the app
up?" has no answer outside of `pnpm dev`. Phase 6.4 wires the
plumbing so that — _when an SRE wires the external systems_ — every
unhandled error, every queue stall, and every uptime regression
becomes a notification.

The slice is intentionally environment-agnostic: it ships the SDK
init, the metrics endpoint, the extended health probe, and a
runbook that documents what the operator has to configure outside
the repo (Sentry DSN, alert rules, uptime monitor URLs, paging
channels). Everything no-ops cleanly when those values are unset
so dev / e2e stay unaffected.

## 2. User stories

- As an **on-call engineer**, I want unhandled API exceptions to
  land in Sentry with trace id + actor id so I can find the
  incident root cause without grepping logs.
- As an **on-call engineer**, I want a Sentry alert when payouts
  HELD count drifts above a threshold so I notice the sweeper
  failing before partners file tickets.
- As an **operator**, I want a single endpoint that reports the
  depth of every BullMQ queue and confirms Redis is reachable so
  uptime monitors and dashboards stay flat against one URL.
- As an **operator**, I want a runbook that lists exactly which
  URLs to wire into an uptime monitor and which Sentry alert
  rules to copy.

## 3. Surfaces

| Surface              | File                                             | Notes                                      |
| -------------------- | ------------------------------------------------ | ------------------------------------------ |
| Sentry init          | `apps/api/src/observability/sentry.ts`           | Boots `@sentry/node` when `SENTRY_DSN` set |
| ProblemFilter hook   | `apps/api/src/common/filters/problem.filter.ts`  | Captures 5xx into Sentry                   |
| `/v1/readyz`         | `apps/api/src/health/health.controller.ts`       | Now includes redis status                  |
| Admin metrics        | `apps/api/src/admin/admin-metrics.controller.ts` | New endpoint at `/v1/admin/metrics`        |
| Shared metrics shape | `packages/shared/src/schemas/admin.ts`           | `metricsResponseSchema`                    |
| Runbook              | `docs/operations/monitoring.md`                  | Sentry + uptime + alert thresholds         |

## 4. API additions

| Method | Path                | Role   | Description                                             |
| ------ | ------------------- | ------ | ------------------------------------------------------- |
| GET    | `/v1/admin/metrics` | ADMIN  | Returns per-queue depth + redis ping + sentry env-state |
| GET    | `/v1/readyz`        | public | (extended) `checks.redis` joins `checks.db`             |

Response shape (new):

```ts
const queueDepthSchema = z.object({
  name: z.string(),
  waiting: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  delayed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});

export const metricsResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  queues: z.array(queueDepthSchema),
  redis: z.object({
    connected: z.boolean(),
    /** ms; null if not connected. */
    pingMs: z.number().nullable(),
  }),
  sentry: z.object({
    /** True iff SENTRY_DSN was set at boot. */
    enabled: z.boolean(),
    environment: z.string().nullable(),
  }),
});
```

## 5. Sentry init

`@sentry/node` registered in `main.ts` before AppModule boots:

```ts
import * as Sentry from '@sentry/node';

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    release: env.SENTRY_RELEASE,
    // Don't ship request bodies — they may contain PII.
    sendDefaultPii: false,
  });
}
```

ProblemFilter sends to Sentry only for statuses ≥ 500 — every
ProblemError, ZodError, HttpException at < 500 is expected
behavior and would just create noise. The capture call includes
the trace id + actor id (when available from `req.user`) as
tags, and the path as a fingerprint hint.

Sentry's init is idempotent on a per-process basis so it's fine
to call once at boot and never again.

## 6. Queue metrics

The admin metrics controller injects all four BullMQ queues by
name and calls `Queue.getJobCounts('waiting','active','delayed','failed','completed')`
on each, returning the result alongside a Redis ping (via
`Queue.client.ping()` on any one queue's connection — they all
share the same connection config).

| Queue                    | Healthy thresholds |
| ------------------------ | ------------------ |
| `bills.generate`         | `waiting < 100`    |
| `bills.daily-sweep`      | `waiting < 5`      |
| `campaigns.expiry-sweep` | `waiting < 5`      |
| `payouts.release-sweep`  | `waiting < 5`      |

Thresholds live in the runbook (operators configure alerts
against them externally) — not in code, because they shift as
volume grows.

When `API_DISABLE_QUEUES=true` the metrics endpoint still works:
queue counts return zeros and Redis reports `connected: false`
if the URL is unreachable.

## 7. Extended readyz

`GET /v1/readyz` already pings the DB. Extension:

```ts
const checks = { db: 'fail', redis: 'fail' };
try {
  await prisma.$queryRaw`SELECT 1`;
  checks.db = 'ok';
} catch {}
try {
  await sharedRedisPing();
  checks.redis = 'ok';
} catch {}
const ok = Object.values(checks).every((c) => c === 'ok');
return { status: ok ? 'ok' : 'degraded', checks };
```

`sharedRedisPing()` reuses the BullMQ-injected `bills.generate`
queue's connection to avoid opening a second pool. Anything that
imports `IORedis` directly would double our connection count.

## 8. Runbook

New file `docs/operations/monitoring.md` with:

- **Sentry** — DSN setup (per app + per env), recommended
  Issue Alerts (any new issue, regression, high error rate on
  `/v1/auth/*` routes), recommended Performance / volume
  thresholds.
- **Uptime monitor** — recommended provider-agnostic checklist:
  hit `https://api.<domain>/healthz` every 1m, hit each PWA's
  root every 5m. Page on >= 3 consecutive failures.
- **Queue health** — pull `/v1/admin/metrics` every 5m, page if
  any queue's `waiting` exceeds the thresholds in §6 for 10
  minutes.
- **Incident triage** — short flowchart: 5xx spike → check
  Sentry → check `/readyz` → check queues → escalate.

The doc explicitly does NOT name a specific provider — we ship
provider-agnostic URLs and let the operator pick (Better Uptime,
UptimeRobot, Pingdom, whatever the org has).

## 9. Env additions

| Var              | Required | Default | Notes                                       |
| ---------------- | -------- | ------- | ------------------------------------------- |
| `SENTRY_DSN`     | no       | unset   | When unset, Sentry init is skipped entirely |
| `SENTRY_RELEASE` | no       | unset   | Tag for release-based grouping              |

Both already partially declared in `apps/api/src/env.ts` — we
add `SENTRY_RELEASE` and document the operator runbook for
setting them.

## 10. Edge cases

- **Sentry DSN unreachable / wrong** — `@sentry/node` swallows
  init failures internally; the API still boots.
- **Redis down** — `/v1/readyz` returns 200 with
  `status: 'degraded'`, `checks.redis: 'fail'`. Uptime monitor
  alerts on the status field, not the HTTP code (consistent
  with the existing DB-down behavior).
- **Queue counts on a fresh DB** — all queues return zeros.
- **Admin metrics under load** — `getJobCounts` is a single
  Redis call per queue; four calls per request is fine even at
  monitor-poll cadence.

## 11. Out of scope

- **Sentry in the four Next.js apps** — needs source-map
  upload + Vercel/runtime integration; defer until we have a
  production deploy and a real DSN per app.
- **PostHog analytics** — separate slice.
- **Custom dashboards** (Grafana, Datadog) — operator-side.
- **Prometheus `/metrics` endpoint** — could be added on top
  of the admin metrics later; not v1.
- **Synthetic checks** (login flow, payment flow as a probe) —
  needs prod-only test creds; out of scope.

## 12. Acceptance criteria

- [x] `@sentry/node` registered in API when `SENTRY_DSN` is
      set; init is skipped silently otherwise.
- [x] ProblemFilter captures 5xx errors to Sentry with
      `traceId` + `actorId` tags.
- [x] `GET /v1/readyz` returns `checks: { db, redis }`.
- [x] `GET /v1/admin/metrics` (ADMIN) returns the four queues'
      counts + redis ping + sentry env-state, validated by
      `metricsResponseSchema`.
- [x] `docs/operations/monitoring.md` documents Sentry alert
      rules, uptime URLs, queue thresholds, triage flow.
- [x] `pnpm turbo typecheck lint test` clean.

## 13. Manual test plan

1. `SENTRY_DSN=https://example.invalid pnpm --filter @repo/api dev` —
   API boots, no crash.
2. Trigger a 500 (e.g. POST malformed JSON to a route that bypasses
   the global filter via a hand-written throw) — confirm a
   Sentry breadcrumb shows up in logs (or in Sentry if DSN is
   real).
3. As admin: `curl http://localhost:3001/v1/admin/metrics -b session-cookie`
   → assert four queue rows + `redis.connected: true`.
4. `curl http://localhost:3001/readyz` → assert
   `checks: { db: 'ok', redis: 'ok' }`.
5. Stop Redis: `docker compose stop redis`. `readyz` returns
   `checks.redis: 'fail'`, status `degraded`.

## 14. Rollout

- No migrations.
- Env vars are optional; no breakage when unset.
- Comms: dev changelog — "API ships Sentry plumbing + admin
  metrics + extended readyz; runbook in docs/operations/."
