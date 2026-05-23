# Spec: Cutover runbook + go-live checklist (phase 9.7)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phases 9.1–9.6 closed the explicit feature deferrals that blocked
real customers. What's left is the cutover itself: DNS, env vars,
secret rotation, smoke tests against the prod URL, and a rollback
plan that's actually been rehearsed.

Per the Phase 9 outline (BUILD_PLAN §Phase 9 item 7):

> Mostly docs + scripts: domain DNS plan, env-var validation script
> that runs in CI deploy step, secret-rotation drill (auth secret,
> Stripe webhook secret, VNPay hash secret), smoke-tests against
> the prod URL, rollback plan that includes a known-good tag +
> migration revert dry-run, oncall escalation runbook. No code in
> `apps/*` apart from the deploy script in `scripts/`.

This slice is intentionally low-code. The deliverables are the
runbook a human can follow at 2am, plus a single CI guardrail that
keeps a malformed prod env from silently shipping.

## 2. User stories

- As **on-call** opening the laptop at 2am, the runbook tells me
  exactly which dashboards to load, which rollback command to run,
  and who to escalate to. Zero reasoning required.
- As a **release engineer** flipping DNS for the first prod cutover,
  I can follow §3 of the runbook step-by-step; each step has a
  verification command and an "if this fails" branch.
- As a **CI maintainer**, the deploy-validation job catches the
  classic "forgot to set `AUTH_SECRET` on Vercel" deploy before it
  hits prod traffic.
- As an **auditor** reviewing the cutover after the fact, every
  change to a secret or env var has a record (audit log + git
  history of the env-shape file).

## 3. Surfaces

| Surface           | Path                                       | Notes                                                                                            |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Cutover runbook   | `docs/runbook/go-live.md` (new)            | Step-by-step DNS / env / smoke / rollback flow.                                                  |
| Env validator     | `scripts/validate-env.ts` (new)            | Reads `target` env (`production` / `staging`) from CLI; exits non-zero on missing required vars. |
| CI workflow       | `.github/workflows/deploy-check.yml` (new) | Runs the validator with a sample `production` env shape on every PR + main push.                 |
| Smoke test script | `scripts/smoke-prod.sh` (new)              | curls a handful of public endpoints with hardcoded expected shapes.                              |
| Main runbook      | `docs/runbook.md` (extended)               | Adds a §Cutover pointer + the post-deploy verification flow.                                     |

## 4. Env validator

`scripts/validate-env.ts` is a small TypeScript file invoked via
`tsx`. It:

1. Reads the target environment as a positional CLI arg
   (`production` or `staging`).
2. Loads a required-vars manifest baked into the file (per-target).
3. Iterates `process.env`, flags any required var that's unset or
   empty, prints them to stderr, exits with code 1.
4. On success, prints `OK: 23 required env vars present` and exits 0.

The manifest is hand-maintained. Adding a new required env var goes
through the manifest — no auto-discovery; the explicit list is the
auditable surface.

```ts
// scripts/validate-env.ts

interface VarSpec {
  name: string;
  reason: string;
}

const PRODUCTION_REQUIRED: VarSpec[] = [
  { name: 'NODE_ENV', reason: 'sets server-side fail-closed defaults' },
  { name: 'DATABASE_URL', reason: 'API cannot start without DB' },
  { name: 'REDIS_URL', reason: 'BullMQ + session store' },
  { name: 'AUTH_SECRET', reason: 'session signing — leak = full takeover' },
  { name: 'STRIPE_SECRET_KEY', reason: 'checkout endpoint 503s without it' },
  { name: 'STRIPE_WEBHOOK_SECRET', reason: 'webhook signature verification' },
  { name: 'VNPAY_TMN_CODE', reason: 'VNPay payment URL signing' },
  { name: 'VNPAY_HASH_SECRET', reason: 'VNPay IPN + refund signing' },
  { name: 'RESEND_API_KEY', reason: 'email delivery (else falls back to stub)' },
  // ... etc per target
];
```

## 5. Runbook contents

`docs/runbook/go-live.md` covers:

1. **Pre-cutover checklist** — DB migration applied, MinIO ↔ S3
   swap confirmed, env vars set on Vercel / Fly, DNS values
   prepared.
2. **DNS plan** — which records to flip, in what order, with TTLs.
   Cloudflare-orange-cloud first, then the apex.
3. **Secret-rotation drill** — `AUTH_SECRET`, `STRIPE_WEBHOOK_SECRET`,
   `VNPAY_HASH_SECRET`. Each: where it lives, what breaks if it
   rolls without coordination, how to roll safely (overlap period
   with both old + new accepted).
4. **Smoke tests** — `curl` commands that should return 200 / a
   structured JSON shape. Reachability + auth + a representative
   write.
5. **Rollback plan** — keep the previous deploy promoted in
   Vercel's history; CLI commands to roll API + each PWA back; how
   to revert the most recent migration if needed.
6. **Post-cutover monitoring** — Sentry, PostHog live events,
   `/v1/admin/dashboard`, ops Slack channel. What "looks healthy"
   means.
7. **Oncall escalation** — paging policy, channel names,
   secondary contact paths.

## 6. CI workflow

`.github/workflows/deploy-check.yml`:

```yaml
name: Deploy Check
on:
  pull_request:
    paths:
      - 'apps/api/src/env.ts'
      - 'scripts/validate-env.ts'
      - '.env.example'
      - '.github/workflows/deploy-check.yml'
  push:
    branches: [main]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Run the validator with a synthetic "all set" env. The job
      # is a meta-test: does the manifest match what the schema in
      # `apps/api/src/env.ts` actually demands?
      - run: pnpm tsx scripts/validate-env.ts production
        env:
          # ... synthetic values for each required var
```

The job is guard-rail-only. It doesn't have access to prod secrets;
it asserts the **shape** is honored. The real prod env lives in
Vercel + Fly secret managers; the validator runs there too, but
that's deploy-runtime, not CI.

## 7. Out of scope

- **Automating the DNS cutover** — Cloudflare-tf, terraform
  modules, etc. v1 cutover is a human walking through the runbook.
- **Self-driving rollback** — the runbook documents the commands;
  flipping them on demand is a human's call.
- **Multi-region failover** — the platform is single-region in v1.
- **Database backup / restore drill** — covered by the existing
  `.github/workflows/backup.yml` + `scripts/backup-postgres.sh`
  / `scripts/restore-postgres.sh`. The runbook references them.

## 8. Acceptance criteria

- [ ] `docs/runbook/go-live.md` exists with sections matching §5.
- [ ] `scripts/validate-env.ts` exists; running it without env vars
      exits non-zero with a printed list of missing vars.
- [ ] Running it with all required vars set exits zero with an
      "OK" message.
- [ ] `.github/workflows/deploy-check.yml` runs the validator on
      every push to `main`.
- [ ] `docs/runbook.md` references the new cutover runbook from its
      table of contents.

## 9. Manual test plan

1. Run `pnpm tsx scripts/validate-env.ts production` locally with
   no env set — see the missing-vars output + non-zero exit.
2. Run it with `AUTH_SECRET=x DATABASE_URL=postgres://... ...` (a
   minimal "all set" line) — see `OK: ...` + zero exit.
3. Push a no-op commit that touches `.env.example`; observe the
   `deploy-check` GitHub Action runs + passes.

## 10. Rollout

- No DB migration.
- No env additions (the validator reads, doesn't add).
- No code in `apps/*` — only `docs/`, `scripts/`, `.github/`.
- The first real cutover will exercise the runbook + leave PRs
  improving it as the operator hits edges.
