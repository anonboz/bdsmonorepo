# Runbook

The top-level operations doc — what to do when something breaks,
and how to do the common ops things without paging the team.

If you got here from a page, jump to **§1 Incident response**
first, then back to the relevant triage flowchart in §2.

For first-prod cutovers + post-cutover monitoring, see
[`docs/runbook/go-live.md`](./runbook/go-live.md). The cutover
runbook is intentionally separate so it can be followed at 2am
without scrolling past steady-state ops content.

---

## 0. Read this when paged

1. **Acknowledge** the page so the rotation knows you're on it.
2. Pop two browser tabs: Sentry (`/v1/auth/*` and recent issues
   filters) and `/v1/admin/metrics`.
3. Drop a thread in `#incidents`: "looking, will update in 10".
4. Move to §1.2 for the first-10-minutes checklist.

Severity ladder (§1.1) tells you whether to escalate. When in
doubt, **escalate up, not later** — easier to stand a page
down than to recover lost minutes.

---

## 1. Incident response

### 1.1 Severity ladder + paging path

| Sev | Criteria                                                             | Paging                           | Comms                         |
| --- | -------------------------------------------------------------------- | -------------------------------- | ----------------------------- |
| S1  | Platform down, all roles affected, or money / data integrity at risk | Page primary + secondary on-call | #incidents + status page open |
| S2  | One role can't complete its critical flow (e.g. owners can't bill)   | Page primary on-call             | #incidents thread             |
| S3  | Degraded but workable (slow, intermittent, single feature)           | Slack ping on-call               | #incidents note               |
| S4  | Background noise (single 500, recoverable error)                     | Ticket, no page                  | Issue tracker                 |

Multi-incident → spin a single comms thread, parallel
investigators per workstream.

### 1.2 First 10 minutes

1. **Confirm scope.** Sentry rate? `/v1/readyz` status? Which
   role is affected?
2. **Snapshot.** Screenshot or copy the failing UI / response /
   stack into the thread — that's the audit trail.
3. **Check recent activity.** `git log --oneline -20 main`. A
   deploy in the last 30 min is the prime suspect.
4. **Branch:** rollback now (§3) if a recent commit is clearly
   the cause, otherwise dig into §2's flowcharts.
5. **Set a 30-min checkpoint** — if no progress, escalate.

### 1.3 Comms

- **Internal:** every notable step lands in the `#incidents`
  thread. "I'm looking at X" / "Y looks normal, ruling out" /
  "rolling back Z". Future-you searching the channel needs
  context.
- **External (status page):** post within 15 min for S1, 30
  min for S2. Template: "Investigating elevated error rates on
  the {role} app. Updates here."
- **Resolution:** post-mortem doc within 48 hours for S1/S2 in
  `docs/incidents/YYYY-MM-DD-<slug>.md` (TBD).

---

## 2. Triage flowcharts

### 2.1 5xx spike

```
1. Sentry → filter level:error in the last 15 min.
   Elevated vs baseline? If no → likely a one-off, S4.

2. Read the top issue's stack + breadcrumbs:
   - Database / Prisma error?    → /v1/readyz (db check). If
                                     degraded, Supabase status.
   - better-auth / Verification? → check OTP throughput + recent
                                     commits in apps/api/src/auth.
   - Queue / sweeper?             → /v1/admin/metrics. See
                                     docs/operations/monitoring.md §3.
   - One specific endpoint?       → blame the last commit on its
                                     handler. Consider §3.1.

3. Decide:
   - Contained → monitor, ticket, S4.
   - Escalating → page on-call, kick off comms.
   - Deploy-implicated → rollback (§3.1).
```

### 2.2 Login broken

```
1. Confirm: try login as e2e.admin@test.local in staging. Does
   the OTP send 200? Does sign-in/email-otp 200?

2. Branch:
   - send-otp 429s? → rate limit (apps/api/src/main.ts §rate-
                       limit). Was a synthetic attack happening?
                       Or did monitoring poll more aggressively?
   - send-otp 5xx?  → check the email provider. RESEND_API_KEY
                       set? Provider status?
   - sign-in 401?   → check Verification table for the OTP row.
                       Was AUTH_SECRET rotated without redeploy?
                       (see secrets-rotation §4)
   - sign-in 5xx?   → Sentry; likely better-auth + DB.

3. Mitigation:
   - Rate-limit issue → tune via API_DISABLE_RATE_LIMIT (last
                         resort) or bump limits in main.ts.
   - Provider issue → email/SMS provider page; consider failover.
   - AUTH_SECRET → see secrets-rotation §4 "AUTH_SECRET" + force
                    re-login (clear Session table; tenants
                    re-OTP).
```

### 2.3 Bills not generating

```
1. /v1/admin/metrics → bills.daily-sweep + bills.generate
   queue counts. Waiting > 0 hours after 02:00 UTC?

2. Branch:
   - waiting > 0, no active → worker dead. Restart the API
                                process (Vercel: redeploy; Fly:
                                rolling restart).
   - active > 0 stuck      → check the job's stack via Sentry.
                                Probably a per-row failure not
                                being retried.
   - completed not growing → the sweeper isn't enqueueing. Check
                                env API_DISABLE_QUEUES. Check
                                BullMQ scheduler in
                                bills.sweeper.ts.

3. Recovery:
   - For missed bills: an owner can hit
     POST /v1/houses/.../bills/generate-now per lease — idempotent
     under (leaseId, periodKey).
   - For sweeper failure: bills.sweeper logs in Pino under the
     api process — search for "billsSweep" / "billsGenerate".
```

### 2.4 Partner payouts stuck

```
1. /v1/admin/metrics → payouts.release-sweep queue counts.

2. Branch:
   - waiting > 0 with no active → worker dead, see 2.3.
   - completed not advancing despite ledger entries → release
     sweeper sees zero rows. Check JobLedgerEntry where
     status='HELD' and cooldownUntil <= now. Should be
     non-zero if partners are owed.
   - audit row payout.release missing for an entry → the sweeper
     finished but didn't audit. Investigate
     apps/api/src/payouts/payouts.service.ts releaseEligible.

3. Communication:
   - If partners reach out before this fires, they're not
     paged automatically (no per-partner alert). Triage via
     audit log: search action='payout.release' for the
     affected partner's user id.
```

### 2.5 Tenant can't pay

Currently there's no in-app payment endpoint — Phase 7+ wires
Stripe / VNPay. Until then, this triage doesn't apply.

When the providers are wired, expect to see:

- Webhook signature failures → provider's secret rotated; see
  secrets-rotation.
- 4xx from `/v1/payments/...` → bill state machine; check audit.
- Card declines → out of our control; surface the provider
  message to the tenant.

---

## 3. Rollback

### 3.1 Vercel rollback (per app)

Each app is its own Vercel project (`admin`, `owner`, `tenant`,
`partner`, `api`).

```
1. Open Vercel → Project → Deployments tab.
2. Identify the last known-good deploy (green check, before the
   incident timestamp).
3. Three-dot menu → "Promote to Production".
4. Watch the rollback complete (~30s).
5. Smoke-test: hit `/healthz` for api, the root for each PWA.
6. Note the rolled-back SHA in the incident thread.
```

CLI:

```sh
vercel rollback <deployment-id>
```

### 3.2 Database migration rollback

Prisma migrations are **forward-only** (see CLAUDE.md). There's
no `prisma migrate down`. To recover from a destructive
migration:

```
1. Identify the dump from immediately before the migration:
   - If a manual workflow_dispatch ran before, use that key.
   - Otherwise pick the most-recent nightly (§6.5 schedule).
2. Spin up a staging DB pointing at a throwaway URL.
3. Run scripts/restore-postgres.sh against staging — verify
   the bad migration is absent and row counts look right.
4. If staging is clean, repeat against production with
   ALLOW_PROD_RESTORE=1.
5. Update the schema + drop the problem migration file (mark
   in MIGRATIONS_LOG.md per CLAUDE.md). Create a new forward
   migration that does the right thing.
6. Re-deploy.
```

This path is destructive — losing post-migration writes. Only
use when the migration left the DB unusable.

### 3.3 Queue purge

If a queue is jammed with poison messages:

```
1. SSH into a process with redis-cli, or use Upstash console.
2. Confirm the queue's bullmq keys: KEYS bds:<queue-name>:*
3. Drain failed jobs:
   - From the API (preferred): add a one-off admin endpoint
     that calls queue.clean(0, 1000, 'failed').
   - From redis-cli (escape hatch): DEL bds:<queue-name>:failed
4. Audit: log who triggered the purge in #incidents.
```

---

## 4. Common ops

### 4.1 Deploy

`main` → Vercel auto-deploys the four PWAs + the API on push.
Manual deploy:

```sh
gh workflow run "CI" --ref main  # re-runs CI on the same SHA
```

### 4.2 Seed dev DB

`pnpm --filter @repo/db db:seed` — see `packages/db/src/seed.ts`.

Tests reset to a smaller seed via `apps/e2e/global-setup.ts`.

### 4.3 Inspect audit log

The admin app has an audit log viewer at `/audit`. Programmatic:

```sh
curl -b cookie.txt http://localhost:4001/v1/admin/audit?limit=50
```

Search by `actorId`, `action` (e.g. `auth.login`, `job.complete`),
or `target` (e.g. `User:<id>`).

### 4.4 Suspend a user

Admin app: `/users/<id>` → "Suspend". Programmatic:

```sh
curl -b cookie.txt -X POST -H 'content-type: application/json' \
  -d '{"reason":"<why>"}' \
  http://localhost:4001/v1/admin/users/<id>/suspend
```

Suspension invalidates the next request — the auth guard rejects
suspended users.

### 4.5 Pause sweepers

Set `API_DISABLE_QUEUES=true` and redeploy the API. Producers
still enqueue (no-op), workers don't process. Use this for
maintenance windows or to stop a runaway sweeper.

To pause one queue specifically, comment out its registration in
`apps/api/src/<feature>/.sweeper.ts` and redeploy — heavier hammer.

### 4.6 Manual backup / restore

See `docs/operations/backups.md`.

```sh
gh workflow run "Backup — Postgres nightly dump"
```

---

## 5. Index of detailed runbooks

| Concern              | Doc                                                                     |
| -------------------- | ----------------------------------------------------------------------- |
| Monitoring + Sentry  | [`docs/operations/monitoring.md`](operations/monitoring.md)             |
| Postgres backups     | [`docs/operations/backups.md`](operations/backups.md)                   |
| Secrets rotation     | [`docs/operations/secrets-rotation.md`](operations/secrets-rotation.md) |
| Load testing (k6)    | [`docs/operations/load-testing.md`](operations/load-testing.md)         |
| Security advisories  | [`docs/security-advisories.md`](security-advisories.md)                 |
| Build plan + roadmap | [`BUILD_PLAN.md`](../BUILD_PLAN.md)                                     |
| Feature specs        | [`docs/specs/`](specs/)                                                 |

---

## 6. Glossary

- **Sweeper** — A BullMQ scheduled job that runs once per
  interval (daily for bills / campaigns / payouts). Distinct
  from a worker which processes individual enqueued jobs.
- **Ledger entry** — A row in `JobLedgerEntry`. Three per
  completed job: CHARGE / COMMISSION / PAYOUT. Sum is zero
  by construction.
- **Cooldown** — The 3-day window between a partner completing a
  job and the platform releasing their payout.
- **Audit row** — A `AuditLog` insert; immutable record of who
  did what when. Every state-changing API call writes one.
- **Problem** — Our RFC 7807 `application/problem+json` error
  shape. See `apps/api/src/common/filters/problem.filter.ts`.
- **`/readyz`** — Liveness + dependency check (DB, Redis).
  `/healthz` is process-alive only.
- **Sentry tag** — Indexed key/value attached to a captured
  event. We tag `traceId`, `path`, and `user.id`.
