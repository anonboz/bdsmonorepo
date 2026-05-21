# Spec: Runbook + secrets rotation (phase 6.6)

> Status: **implemented**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

6.4 left a monitoring runbook and 6.5 left a backups runbook, but
both are surface-specific. When a page fires at 3am the on-call
shouldn't have to guess which doc holds the right flowchart — they
need a top-level `docs/runbook.md` that's the index for everything
ops-shaped.

BUILD_PLAN §6 item 6 also asks for a **secrets rotation policy**.
The repo has half a dozen secrets in play (auth signing, DB
password, Redis, S3 keys, Sentry DSN), each with its own rotation
posture. Putting them in one place — with cadence + procedure +
post-rotation smoke test — closes the Phase 6 hardening list.

## 2. User stories

- As an **on-call engineer**, I want to open `docs/runbook.md`
  and see a triage tree for the most likely incidents, with
  links to deeper procedures.
- As a **new engineer**, I want one doc that lists the common
  ops commands (deploy, rollback, db migrate, seed reset,
  feature-flag flip) so I can run them without pinging the
  team.
- As a **security reviewer**, I want a written policy for each
  secret — when to rotate, how to rotate, how to verify — so
  rotation isn't tribal knowledge.

## 3. Surfaces

| Surface           | File                                  | Notes                                 |
| ----------------- | ------------------------------------- | ------------------------------------- |
| Top-level runbook | `docs/runbook.md`                     | Triage tree + common ops + index      |
| Secrets rotation  | `docs/operations/secrets-rotation.md` | Per-secret cadence + procedure + test |

No app code changes. No migrations.

## 4. Top-level runbook — outline

```
docs/runbook.md
├── 0. Read this when paged
├── 1. Incident response
│   ├── 1.1 Severity ladder + paging path
│   ├── 1.2 First 10 minutes checklist
│   └── 1.3 Comms (internal + customer)
├── 2. Triage flowcharts
│   ├── 2.1 5xx spike
│   ├── 2.2 Login broken
│   ├── 2.3 Bills not generating
│   ├── 2.4 Partner payouts stuck
│   └── 2.5 Tenant can't pay (Phase 7+)
├── 3. Rollback
│   ├── 3.1 Vercel rollback (per app)
│   ├── 3.2 Database migration rollback
│   └── 3.3 Queue purge
├── 4. Common ops
│   ├── 4.1 Deploy
│   ├── 4.2 Seed dev DB
│   ├── 4.3 Inspect audit log
│   ├── 4.4 Suspend a user
│   ├── 4.5 Pause sweepers
│   └── 4.6 Manual backup / restore
├── 5. Index of detailed runbooks
│   ├── Monitoring → docs/operations/monitoring.md
│   ├── Backups → docs/operations/backups.md
│   └── Secrets rotation → docs/operations/secrets-rotation.md
└── 6. Glossary
```

Each "triage flowchart" is a short numbered procedure — see §6 of
this spec for the shape.

## 5. Secrets rotation — outline

```
docs/operations/secrets-rotation.md
├── 1. Why we rotate
├── 2. Inventory (per secret)
│   ├── AUTH_SECRET (Better-Auth signing key)
│   ├── DATABASE_URL (Postgres password)
│   ├── REDIS_URL (Upstash token)
│   ├── BACKUP_DATABASE_URL (separate prod-read role)
│   ├── BACKUP_AWS_ACCESS_KEY_ID / SECRET_ACCESS_KEY
│   ├── SENTRY_DSN (Sentry write key)
│   ├── RESEND_API_KEY (when wired)
│   ├── Stripe / VNPay (when wired)
│   └── GitHub Actions secrets (a few cross-cutting)
├── 3. Cadence table
├── 4. Rotation procedures (one per secret)
└── 5. Emergency rotation
```

Each procedure is structured the same way:

```
### <SECRET_NAME>

**Where it lives:**     <env files, deploy provider, vaults>
**Who reads it:**       <process / role>
**Rotation cadence:**   <90d / quarterly / on-demand-only>
**Last rotated:**       <table at the bottom>
**Procedure:**
1. <step>
2. <step>
**Verify:**             <smoke test that proves rotation worked>
**Rollback:**           <how to recover if rotation breaks prod>
```

A trailing table tracks last-rotation dates per secret per env so
audits don't need git blame.

## 6. Triage flowchart shape

Example for `5xx spike` — the runbook will carry a flowchart for
each of the listed scenarios:

```
1. Confirm: open Sentry → filter level:error in the last 15 min
   → is the rate elevated vs baseline?

2. Identify: top-issue. Read the stack + breadcrumbs.

3. Branch:
   - Database/Prisma error?      → check /readyz → if degraded,
                                    check Supabase status page
   - Auth (better-auth)?          → check verification table size,
                                    OTP throughput, recent commits
                                    on apps/api/src/auth
   - Queue / sweeper?             → /v1/admin/metrics → see
                                    monitoring runbook §3
   - One specific endpoint?       → look at the affected handler's
                                    last commit; consider rollback

4. Decide:
   - If contained → notify #incidents, monitor
   - If escalating → page on-call, kick off comms (runbook §1.3)
   - If a recent deploy is implicated → see rollback §3.1
```

## 7. Cadence table (preview)

| Secret                    | Cadence      | Notes                                                |
| ------------------------- | ------------ | ---------------------------------------------------- |
| `AUTH_SECRET`             | 180 days     | Invalidates all sessions; rotate off-hours.          |
| `DATABASE_URL` password   | 180 days     | Rotate via Supabase console; redeploy each app.      |
| `REDIS_URL`               | 180 days     | Rotate via Upstash; sweepers reconnect on next tick. |
| `BACKUP_*` AWS keys       | 90 days      | Standard cadence for AWS IAM access keys.            |
| `SENTRY_DSN`              | on-demand    | DSN isn't a secret per se; rotate only if leaked.    |
| GitHub Actions secrets    | 180 days     | Catch-all for the above when stored in Actions.      |
| `RESEND_API_KEY` (future) | 180 days     | When wired.                                          |
| Stripe / VNPay (future)   | per-provider | Follow provider's rotation guidance.                 |

## 8. Edge cases / out of scope

- **Secrets in browser bundles** — `NEXT_PUBLIC_*` env vars are
  baked into the build and shipped to clients; they're not
  secret. Document which ones are "public-by-design".
- **Hardware key management (HSM)** — out of scope for v1.
- **Centralized vault (1Password / Vault)** — recommended but
  operator-owned; the doc references it without prescribing.
- **Per-environment differences** — staging / prod columns in
  the cadence table to make the matrix explicit.
- **Automated rotation (Vault dynamic secrets, AWS IAM
  rotation Lambdas)** — out of scope; the doc is the
  step-by-step manual process.

## 9. Acceptance criteria

- [x] `docs/runbook.md` exists with the outline in §4 filled in.
- [x] `docs/operations/secrets-rotation.md` lists every secret
      currently in use with a cadence + procedure + verify step.
- [x] The runbook cross-links to monitoring + backups +
      secrets-rotation.
- [x] No code / migration changes; pipeline stays green.

## 10. Manual test plan

1. As a new engineer, open `docs/runbook.md` cold. Pick one
   triage scenario — should be able to follow it without
   asking for context.
2. As an on-call, pick one secret in
   `docs/operations/secrets-rotation.md`, follow the procedure
   end-to-end in a dev env. Confirm the verify step proves
   rotation worked.
3. `pnpm turbo typecheck lint` clean (no code changed, just
   docs).

## 11. Rollout

- Docs only.
- No flag, no migration.
- Comms: dev changelog — "ops runbook + secrets rotation policy
  live; both linked from `docs/runbook.md`."
