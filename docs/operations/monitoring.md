# Monitoring runbook

What to configure outside the repo so the observability plumbing
that ships in Phase 6.4 actually pages someone when the platform
misbehaves.

> This file is provider-agnostic. Pick whichever Sentry plan, uptime
> monitor, and pager fits the org — the code-side hooks are the
> same.

## 1. Sentry

### 1.1 Project setup

1. Create one Sentry project per surface: `api`, `admin`, `owner`,
   `tenant`, `partner`. (6.4 wires the API only — the four PWAs
   ship without Sentry until we have source-map upload + Vercel
   integration, which is a separate slice.)
2. Copy the API project's DSN into `apps/api/.env`:

   ```env
   SENTRY_DSN=https://<key>@oXYZ.ingest.sentry.io/<project-id>
   SENTRY_RELEASE=<git-sha or release tag>
   ```

3. Production secrets live wherever you deploy (Vercel env, Fly
   secrets, Doppler, etc.) — never check the DSN in.

### 1.2 What gets captured

`apps/api/src/common/filters/problem.filter.ts` forwards every
exception that becomes a 5xx response. 4xx (ProblemError, ZodError,
expected HttpException) is filtered out because it's signal-free.

Tags attached to every captured event:

| Tag       | Source                           |
| --------- | -------------------------------- |
| `traceId` | `x-trace-id` header or req.id    |
| `path`    | request URL                      |
| `user.id` | `req.user.id` when authenticated |

Trace sampling: 10% in production, 0% elsewhere
(`apps/api/src/observability/sentry.ts`).

### 1.3 Recommended alert rules

In **Sentry → Alerts** create:

| Name                     | Condition                                                                     | Channel      |
| ------------------------ | ----------------------------------------------------------------------------- | ------------ |
| New issue                | "A new issue is created"                                                      | #incidents   |
| Auth-route regression    | "An issue is seen more than 10 times in 5 minutes" — filter `path:/v1/auth/*` | page on-call |
| Payment-route regression | "...10 times in 5 minutes" — filter `path:/v1/me/bills/*`                     | page on-call |
| Volume spike             | "Issue count > 50/hour"                                                       | #incidents   |

`#incidents` and "page on-call" are slot names — wire each to
whatever your channel + paging integration is (Slack webhook,
PagerDuty integration, Opsgenie).

### 1.4 What does NOT page

- 4xx responses (validation, auth, not-found) — these are
  expected client behavior.
- Rate-limit 429s — see `apps/api/src/main.ts`; clients should
  see them, ops shouldn't be paged.
- Sweepers logging at info-level — Pino, not Sentry.

## 2. Uptime monitoring

### 2.1 URLs to monitor

| URL                            | Frequency | Expect              |
| ------------------------------ | --------- | ------------------- |
| `https://api.<domain>/healthz` | 1 min     | 200 + uptime field  |
| `https://api.<domain>/readyz`  | 1 min     | 200 + `status:'ok'` |
| `https://admin.<domain>/`      | 5 min     | 200                 |
| `https://owner.<domain>/`      | 5 min     | 200                 |
| `https://tenant.<domain>/`     | 5 min     | 200                 |
| `https://partner.<domain>/`    | 5 min     | 200                 |

`/healthz` is liveness (process up). `/readyz` is readiness (DB

- Redis reachable) — that's the one to alert on.

### 2.2 Page condition

Three consecutive failures (3 minutes for `/healthz`/`/readyz`,
15 minutes for the PWA roots). Tunable per provider.

### 2.3 Status-page integration

If you publish a public status page, drive its checks from the
same URLs. `/readyz` returns `status: 'degraded'` (HTTP 200 still)
when only Redis is down — that maps to a "partial outage" on
status pages.

## 3. Queue depth

### 3.1 Source endpoint

`GET /v1/admin/metrics` (ADMIN role) returns:

```json
{
  "generatedAt": "2026-05-21T00:00:00Z",
  "queues": [
    {
      "name": "bills.generate",
      "waiting": 0,
      "active": 0,
      "delayed": 0,
      "failed": 0,
      "completed": 12
    },
    {
      "name": "bills.daily-sweep",
      "waiting": 0,
      "active": 0,
      "delayed": 1,
      "failed": 0,
      "completed": 5
    },
    {
      "name": "campaigns.expiry-sweep",
      "waiting": 0,
      "active": 0,
      "delayed": 1,
      "failed": 0,
      "completed": 5
    },
    {
      "name": "payouts.release-sweep",
      "waiting": 0,
      "active": 0,
      "delayed": 1,
      "failed": 0,
      "completed": 5
    }
  ],
  "redis": { "connected": true, "pingMs": 4 },
  "sentry": { "enabled": true, "environment": "production" }
}
```

### 3.2 Recommended thresholds

| Queue                    | Threshold for `waiting` | Reason                                   |
| ------------------------ | ----------------------- | ---------------------------------------- |
| `bills.generate`         | > 100 sustained 10 min  | Many tenants × monthly bill window       |
| `bills.daily-sweep`      | > 5 sustained 10 min    | One job per day; > 5 means sweeper stuck |
| `campaigns.expiry-sweep` | > 5 sustained 10 min    | Same.                                    |
| `payouts.release-sweep`  | > 5 sustained 10 min    | Same. Partners block on this.            |

Failures (`failed > 0`) on any queue page on-call regardless of
waiting depth — a failed bill or payout job is a money problem.

### 3.3 Wire-up

A minimal cron loop pulls the endpoint and forwards to whatever
alerting system you use. Suggested poll interval: 5 minutes.

The admin auth cookie is the only thing in the way — issue a
long-lived service account session for the monitor. The runbook
for that lands in 6.6 with secrets rotation.

## 4. Incident triage

Page received → run this flow:

```
1. /v1/readyz — does DB / Redis report degraded?
   yes → infra alert. Restore the underlying service first.

2. Sentry — any new issues in the last 10 min?
   yes → click into the top issue, check the trace + actor id,
         search audit log for the same actorId/path.

3. /v1/admin/metrics — any queue with waiting > threshold or
   failed > 0?
   yes → check the worker logs for that queue (Pino, search by
         queue name), look for repeated stack traces.

4. None of the above — escalate. Check recent deploys + commits;
   roll back if a recent change correlates.
```

## 5. What this slice does NOT cover

- **PWA Sentry** — frontend errors land in browser consoles only
  until we wire `@sentry/nextjs` per app (separate slice, needs
  source-map upload config).
- **Custom dashboards** — Grafana / Datadog / Honeycomb — operator
  choice; the metrics endpoint is the input.
- **Synthetic transactions** (full booking flow as a probe) —
  requires prod-only test credentials. Phase 7+.
- **PostHog analytics** — separate slice; the env var hook exists
  (`POSTHOG_KEY`) but nothing reads it yet.
