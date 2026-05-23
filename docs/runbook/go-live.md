# Go-live runbook

The cutover checklist. Read this on the morning of the cutover. Run
each section top-to-bottom; don't skip the verification commands.

The on-call's role is to follow the runbook, not to improvise.
When something doesn't match expectations: stop, post in
`#cutover`, escalate to the secondary on-call.

> **Audience:** release engineer + on-call.
> **Pre-reqs:** Phase 9.1–9.6 merged and deployed to staging.
> **Estimated wall-clock:** 90 minutes happy path; allow 4 hours
> with buffer for the rollback drill.

---

## 0. Definitions

| Term               | Meaning                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Prod**           | The customer-facing deployment after cutover. Currently empty / staging-only pre-cutover.                              |
| **Staging**        | The pre-prod environment that mirrors prod env vars + secrets. Used as the rollback target.                            |
| **Known-good tag** | The git SHA of the last deploy that was healthy under prod traffic. Pin in `#cutover` before flipping.                 |
| **Secret triad**   | `AUTH_SECRET`, `STRIPE_WEBHOOK_SECRET`, `VNPAY_HASH_SECRET`. Rolling any of these requires the overlap protocol in §4. |

---

## 1. Pre-cutover checklist (T-24h)

Complete the day before. Each line is a stop-the-launch blocker
unless explicitly noted as optional.

- [ ] `pnpm turbo typecheck lint test` clean on `main`.
- [ ] `pnpm audit --prod --audit-level=critical` exits 0 (the
      Phase 8.5 CI gate is now blocking, so this should already be
      true on green main).
- [ ] All Phase 9 migrations applied on staging DB via
      `pnpm --filter @repo/db exec prisma migrate deploy`.
- [ ] Staging smoke flow:
  - [ ] Tenant signup → email-OTP → first sign-in.
  - [ ] Owner publish house → unit → lease → bill generate.
  - [ ] Tenant pays bill via Stripe (test card `4242 4242 4242 4242`).
  - [ ] Tenant pays bill via VNPay (sandbox card).
  - [ ] Owner refunds VNPay payment (9.2 path).
  - [ ] Partner Stripe Connect onboarding (test SSN `000-00-0000`,
        routing `110000000`).
  - [ ] Admin disburses partner payout via Stripe Connect (9.1).
  - [ ] Admin erases a test user (9.3); MediaAsset row flips,
        PostHog person delete fires.
  - [ ] Tenant mutes a notification topic; next dispatch is
        skipped (9.4).
  - [ ] PostHog dashboard shows `user.signed_up` for the new
        signup (9.5).
  - [ ] Admin changes commission rate from 10% → 12%; next
        completed job uses 12% (9.6).
- [ ] Sentry receives a deliberate test exception from each PWA +
      the API (use a hidden `/debug-sentry` route in staging).
- [ ] Backup snapshot: trigger `.github/workflows/backup.yml`
      manually; verify the artifact lands.
- [ ] Vercel env vars set on every project (admin, owner, tenant,
      partner, api). Run `pnpm tsx scripts/validate-env.ts production`
      with the prod env loaded — should print `OK`.
- [ ] DNS records prepared but **not flipped**. CNAMEs / A records
      typed into Cloudflare with TTL set to 60s for the cutover
      window (revert to 3600s after).
- [ ] `#cutover` Slack channel has on-call (primary + secondary) + release engineer + at least one stakeholder for go/no-go.
- [ ] Pin the known-good tag in `#cutover`:
      `git rev-parse main` from the last green deploy.

---

## 2. DNS plan (T-0)

DNS gets flipped during a low-traffic window. We orange-cloud through
Cloudflare so we can revert in seconds without DNS propagation lag.

### 2.1 Order of operations

1. **`api.<domain>`** flips first. The four PWAs target the API by
   absolute URL; if the API is wrong, the PWAs will surface the
   error in Sentry within seconds.
2. **Internal smoke**: `curl https://api.<domain>/healthz`. Must
   return 200 + JSON `{ status: 'ok', ... }`.
3. **`admin.<domain>` → `owner.<domain>` → `tenant.<domain>` → `partner.<domain>`**.
   In this order: admin first so we can use it to monitor; tenant
   last so customer impact is lowest if one of the earlier flips
   exposed a bug.
4. **`<domain>` (apex)** — last. The apex resolves to a redirector
   pointing at the marketing surface; flipping it traps customers
   in the new ecosystem.

### 2.2 Verification per record

After each flip, run:

```bash
# DNS reachability
dig +short <subdomain>.<domain>

# HTTPS handshake + body
curl -sS -i https://<subdomain>.<domain>/healthz | head -1

# Per app — load the home in a real browser, sign in
```

If any step fails for ≥ 60s past the propagation window: stop, post
in `#cutover`, and follow §6.

### 2.3 TTL hygiene

Before flip: TTL = 60s. After all flips green for 24h: bump TTL
back to 3600s. Update the Cloudflare records in a single edit so
the upper bound on a revert stays predictable.

---

## 3. Env vars on Vercel + Fly

`scripts/validate-env.ts` is the source of truth for "what must be
set". The script runs as part of the deploy pipeline; this section
documents what each value is + where to find it.

### 3.1 The required-vars manifest (per the script)

See `scripts/validate-env.ts` for the canonical list. Briefly:

- **Core**: `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`,
  `API_PUBLIC_URL`, `API_CORS_ORIGINS`.
- **Auth**: `AUTH_SECRET` (32+ bytes, random),
  `AUTH_JWT_ACCESS_TTL`, `AUTH_JWT_REFRESH_TTL`,
  `AUTH_COOKIE_DOMAIN`.
- **Payments**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`,
  `VNPAY_PAYMENT_URL` (sandbox vs prod), `VNPAY_REFUND_URL`.
- **Storage**: `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_UPLOADS`, `S3_PUBLIC_BASE`
  (CDN URL).
- **Email**: `RESEND_API_KEY`, `EMAIL_FROM`.
- **Observability**: `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST`,
  `POSTHOG_PERSONAL_API_KEY` (for the 9.3 erasure flow).
- **App URLs**: `TENANT_APP_URL`, `PARTNER_APP_URL` — used in
  payment redirects + Stripe Connect onboarding return URLs.
- **PWAs** (each project gets its own):
  `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SENTRY_DSN`,
  `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`.

### 3.2 Where the secrets live

| Secret                     | Source of truth                               | Notes                                                                   |
| -------------------------- | --------------------------------------------- | ----------------------------------------------------------------------- |
| `AUTH_SECRET`              | 1Password vault: `bds-prod / auth`            | Random 32+ bytes. Roll via §4.                                          |
| `STRIPE_SECRET_KEY`        | Stripe dashboard → API keys → restricted key  | Restricted to Charges + PaymentIntents + Transfers + Refunds + Connect. |
| `STRIPE_WEBHOOK_SECRET`    | Stripe dashboard → Webhooks → endpoint detail | One per endpoint; rotate when adding/removing a webhook endpoint.       |
| `VNPAY_HASH_SECRET`        | VNPay merchant portal                         | Roll via §4 — both checkout sign + IPN verify use this.                 |
| `VNPAY_TMN_CODE`           | VNPay merchant portal                         | Public-ish but treat as secret.                                         |
| `POSTHOG_KEY`              | PostHog → Project settings → Project API key  | Ingest-only; safe to roll without coordination.                         |
| `POSTHOG_PERSONAL_API_KEY` | PostHog → Personal API keys                   | Admin-scoped. Required for the 9.3 erasure flow only.                   |
| `S3_*`                     | AWS IAM → bds-prod-api user                   | Rotate by issuing a new keypair; overlap.                               |
| `RESEND_API_KEY`           | Resend dashboard                              | Domain-scoped to `<domain>`; rolls safely.                              |

### 3.3 Setting them

Vercel (per project, per environment):

```bash
vercel env add AUTH_SECRET production
# paste value when prompted; redeploys are not triggered automatically.
vercel --prod  # trigger a redeploy
```

Fly (for the API):

```bash
fly secrets set AUTH_SECRET=... STRIPE_SECRET_KEY=... -a bds-api
# Fly restarts the API after secrets land.
```

---

## 4. Secret-rotation drill

The **secret triad** rotates with a coordinated overlap so a
mid-flight request doesn't blow up.

### 4.1 `AUTH_SECRET`

Better-Auth signs sessions with this value. Rolling it invalidates
every in-flight session. Procedure:

1. Pick the new secret: `openssl rand -hex 32`.
2. Set it on prod (`fly secrets set AUTH_SECRET=<new>`). Fly does a
   rolling restart; ~30s downtime per node.
3. Existing sessions are invalidated; every user re-signs in via
   email-OTP.
4. **Drill quirk:** there's no "accept old + new" overlap in
   Better-Auth's v1 single-secret config. If we ever need a
   zero-downtime rotation, the engineering work is documented in
   `docs/adr/0002-auth-secret-rotation.md` (not yet written —
   write it when ops asks).

### 4.2 `STRIPE_WEBHOOK_SECRET`

Per Stripe's docs: add a **second** webhook endpoint with a fresh
secret, deploy with the secret env var set to the new value, and
delete the old endpoint once traffic has flipped.

1. Stripe dashboard → Webhooks → Add endpoint pointing at
   `api.<domain>/v1/webhooks/stripe`. Save the new secret.
2. Update `STRIPE_WEBHOOK_SECRET` on Fly.
3. Wait one Stripe retry window (~6h) to confirm no inflight
   webhook is referencing the old endpoint.
4. Delete the old endpoint from Stripe.

### 4.3 `VNPAY_HASH_SECRET`

VNPay doesn't support multiple secrets. The drill:

1. Coordinate with VNPay support — they rotate on their side at a
   specific moment.
2. Update `VNPAY_HASH_SECRET` on Fly **immediately** after VNPay
   confirms the change. Fly does a rolling restart.
3. There will be a 30–60s window where IPN signature verification
   may 97 reject deliveries; the IPN sender retries, so no data
   loss as long as the retry window is longer than the rollover.
4. Run a real-money smoke payment after the change to confirm
   end-to-end.

---

## 5. Smoke tests

Run after each cutover step. `scripts/smoke-prod.sh` automates the
core curls; this section documents the assertions.

### 5.1 API reachability

```bash
curl -sS -i https://api.<domain>/healthz
# 200 OK, JSON body { "status": "ok", "db": "ok", "redis": "ok" }
```

### 5.2 Auth (unauthenticated)

```bash
curl -sS https://api.<domain>/v1/me
# 401 with content-type: application/problem+json
#   { "type": "auth.unauthenticated", ... }
```

### 5.3 Webhook signature verification

```bash
curl -sS -X POST https://api.<domain>/v1/webhooks/stripe \
  -H 'Content-Type: application/json' \
  -d '{}'
# 400 payments.webhook_invalid — confirms STRIPE_WEBHOOK_SECRET is wired.
```

### 5.4 Per-PWA homes

For each of admin, owner, tenant, partner:

```bash
curl -sS -i https://<role>.<domain>/
# 200 OK; CSP + HSTS headers present.
```

### 5.5 Sentry sanity

Trigger the hidden `/debug-sentry` route on each PWA (a one-off
SSR throw). Confirm the event lands in the Sentry project tagged
with `app_role`.

### 5.6 PostHog sanity

Sign in as a fresh test user on the tenant app. PostHog live-events
should show:

- `user.signed_up` (one-time, from the 9.5 hook).
- `user.signed_in` (from the 8.7 client island).
- `$pageview` for each route navigated.

---

## 6. Rollback plan

Stop-the-clock if anything in §2 or §5 fails for ≥ 60s past the
expected window.

### 6.1 Vercel rollback

Each Vercel project's Deployments page lists every prior build.
Click the previous green deployment → "Promote to production". DNS
already points at the project, so the rollback is immediate.

For the API on Fly:

```bash
fly releases -a bds-api          # list recent releases
fly deploy --image <prior-image> -a bds-api   # roll back
```

### 6.2 Migration revert dry-run

Before cutover, identify the migrations applied in this release:

```bash
git log <known-good-tag>..main -- packages/db/prisma/migrations
```

For each, write the inverse SQL (DROP TABLE / DROP COLUMN / etc.)
into a private gist; do **not** commit. The dry-run is to confirm
the rollback path exists; we don't run them unless data integrity
is at risk.

**Important:** the additive migrations from Phase 9 (stripe_connect,
payment_capture_date, notification_preferences, platform_config) are
all safe to leave in place during a rollback — the prior code paths
don't reference them. We only revert migrations if a forward-only
column type change is in flight (none in this release).

### 6.3 DNS revert

If a flip went sideways:

1. Cloudflare → revert the record to its pre-cutover value.
2. TTL is 60s, so propagation is fast.
3. Post in `#cutover` with the timestamp + reason.

---

## 7. Post-cutover monitoring

For 24h after cutover, watch:

- **Sentry**: errors should be in the same ballpark as staging's
  baseline. Sudden spikes → §6.
- **PostHog live events**: `user.signed_in`, `bill.paid`,
  `job.completed` should be ticking at expected rates.
- **`/v1/admin/dashboard`**: occupancy, MRR, overdue, ticket SLA.
  No values should regress vs. staging.
- **Resend dashboard**: email delivery success rate ≥ 99%; failures
  trickle into `Notification.failureReason` (8.2 grep target).
- **Stripe webhook events**: should be 100% processed in the
  WebhookEvent table.
- **Fly metrics**: API CPU < 60%, RAM < 70%, latency p99 < 500ms.

If any of these look wrong, post in `#cutover` and check the
relevant section of `docs/runbook.md` (incident response).

---

## 8. Oncall escalation

| Sev | Who pages                       | Channel      | Response SLA |
| --- | ------------------------------- | ------------ | ------------ |
| 1   | Primary on-call, then secondary | `#incidents` | 15 min       |
| 2   | Primary on-call                 | `#incidents` | 1 hour       |
| 3   | File a ticket                   | (no page)    | next biz day |

Primary on-call rotation lives in PagerDuty (`bds-prod` schedule).
Secondary is whoever's on the engineering manager rotation.

The full incident-response flowchart is in `docs/runbook.md` §1.
This cutover doc only covers the cutover itself.

---

## 9. After-action

Once 24h post-cutover monitoring is green:

1. Bump DNS TTL back to 3600s.
2. Delete the staging duplicate Stripe webhook endpoint.
3. Run `pnpm audit --prod --audit-level=critical` against the prod
   lockfile (should still be 0).
4. File an after-action note in `docs/operations/` capturing what
   broke + what we'd do differently. Future Phase 10's prep doc
   reads from these notes.

The known-good tag from §1's pre-cutover checklist becomes the
default rollback target until the next deploy.
