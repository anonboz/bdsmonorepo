# Secrets rotation policy

When and how to rotate every secret the platform holds. Each
entry has:

- **Where it lives** — env files, deploy provider, GitHub secrets
- **Who reads it** — the process / role that consumes it
- **Cadence** — calendar rotation schedule
- **Procedure** — step-by-step
- **Verify** — smoke test that proves the rotation worked
- **Rollback** — how to recover if the rotation breaks prod

A table at the bottom tracks last-rotation timestamps so audits
don't need git blame.

---

## 1. Why we rotate

- **Reduce the blast radius of a leak.** A 180-day-old key that
  leaks today exposes at most 180 days of history.
- **Force the rotation procedure to stay working.** If we only
  rotate after a breach we'll discover the procedure broke six
  months ago.
- **Match provider lifetime defaults** so we're not the slowest
  link in the chain.

What we **don't** rotate:

- `NEXT_PUBLIC_*` env vars — public by design.
- Build-time constants — they're not secrets.

---

## 2. Inventory

### `AUTH_SECRET`

**Where it lives:** `apps/api/.env` locally; Vercel project env
for prod; GitHub Actions secret for e2e CI (the value there is a
known throwaway).
**Who reads it:** `apps/api/src/auth/better-auth.config.ts` — used
to sign session cookies + verify them on every request.
**Cadence:** 180 days. Off-hours.
**Procedure:**

1. Generate: `openssl rand -base64 48` (≥ 32 chars; better-auth
   requires it).
2. Stage the new value in Vercel as `AUTH_SECRET_NEW`. Don't
   replace yet.
3. Choose a maintenance window — rotation invalidates all
   sessions; everyone must re-OTP.
4. In Vercel, swap `AUTH_SECRET = AUTH_SECRET_NEW`. Delete the
   old value.
5. Trigger a redeploy on each app + the API so the new secret is
   picked up.
6. Truncate the `Session` table (`DELETE FROM "Session"`) so any
   sessions still using the old signing key are evicted cleanly
   rather than hanging until expiry.
7. Update the table at §3.

**Verify:**

```sh
# Pre-existing session cookie should now 401.
curl -b old-session.txt -i http://localhost:3001/v1/me
# → 401 auth.unauthenticated

# Fresh OTP login should succeed.
curl -X POST http://localhost:3001/v1/auth/email-otp/send-verification-otp \
  -H 'content-type: application/json' \
  -d '{"email":"<your-email>","type":"sign-in"}'
```

**Rollback:**
Restore the previous `AUTH_SECRET` from Vercel's env history,
redeploy. Sessions issued under the new key 401 until they
re-login — the platform stays up.

---

### `DATABASE_URL` (Postgres password)

**Where it lives:** `apps/api/.env`; Vercel env; CI workflow env
(throwaway test DB).
**Who reads it:** Prisma client (everywhere via `@repo/db`).
**Cadence:** 180 days.
**Procedure:**

1. In the Postgres provider (Supabase) console, rotate the role
   password — Supabase exposes "Reset database password".
2. The Supabase pooler URL embeds the password; copy the new
   connection string.
3. Update `DATABASE_URL` in Vercel; redeploy the API + any app
   that talks to the DB directly (none currently — only API).
4. Update `BACKUP_DATABASE_URL` if it uses the same role (it
   should use a separate read-only role — see below).
5. Update the table at §3.

**Verify:**

```sh
# /readyz returns checks.db: 'ok'
curl http://localhost:3001/readyz
# A simple authed call exercises the connection.
curl -b cookie.txt http://localhost:3001/v1/me
```

**Rollback:**
Restore the previous password via the Supabase console (most
providers let you reset to a known value). Until then, the API
errors on every DB call.

---

### `REDIS_URL`

**Where it lives:** same as DATABASE_URL.
**Who reads it:** BullMQ (queue producers + workers) +
`/v1/readyz` ping.
**Cadence:** 180 days.
**Procedure:**

1. Rotate the Upstash token (or whatever provider) in their
   console. Most providers issue a new connection string.
2. Update `REDIS_URL` in Vercel + redeploy.
3. Sweepers reconnect on the next tick; no manual restart needed.
4. Update the table at §3.

**Verify:**

```sh
curl http://localhost:3001/readyz
# checks.redis: 'ok', pingMs < 50ms typically.

# Sweeper liveness: /v1/admin/metrics queues count should be
# non-stale (`generatedAt` is now-ish).
curl -b admin-cookie.txt http://localhost:3001/v1/admin/metrics
```

**Rollback:**
Many providers keep the previous credential valid for a grace
window. If not, recreate the previous URL value from your secret
manager / 1Password vault.

---

### `BACKUP_DATABASE_URL`

**Where it lives:** GitHub Actions secret only.
**Who reads it:** `scripts/backup-postgres.sh`, invoked by the
nightly backup workflow.
**Cadence:** 180 days, **OR** every time `DATABASE_URL` rotates
if they share a role (they shouldn't).
**Procedure:**

1. In Supabase, create / use a **read-only role** for backups —
   e.g. `backup_reader` with `pg_read_all_data`. (If you're using
   the default `postgres` superuser for backups, fix that first.)
2. Reset that role's password.
3. Update `BACKUP_DATABASE_URL` in repo secrets
   (Settings → Secrets → Actions).
4. Manually fire `Backup — Postgres nightly dump` (workflow_dispatch).
   Confirm the green check + object lands in the bucket.
5. Update the table at §3.

**Verify:** see `docs/operations/backups.md` §5.

**Rollback:**
The old secret is gone from GitHub once overwritten. Recreate it
from your secret manager. If a nightly run failed because of bad
rotation, the next scheduled run picks up after the fix.

---

### `BACKUP_AWS_ACCESS_KEY_ID` + `BACKUP_AWS_SECRET_ACCESS_KEY`

**Where it lives:** GitHub Actions secrets.
**Who reads it:** `aws s3 cp` inside the backup workflow.
**Cadence:** 90 days (AWS recommends ≤ 90 for static keys).
**Procedure:**

1. In AWS IAM, the workflow's user → Security credentials → Create
   new access key (the user can have 2 active at once for safe
   rotation).
2. Copy ID + secret into GitHub secrets, replacing the old values.
3. Wait one nightly cycle (or fire manually) to confirm the new
   key works.
4. Disable the old key in IAM (don't delete yet).
5. After 7 days, delete the old key entirely. Update §3.

**Verify:**

```sh
# Manual dispatch:
gh workflow run "Backup — Postgres nightly dump"
# Watch the run → confirm green + new object in S3 with the
# expected timestamp.
```

**Rollback:**
The old key is still active until step 4; just revert the
secrets in GitHub.

---

### `SENTRY_DSN`

**Where it lives:** Vercel env for the API.
**Who reads it:** `apps/api/src/observability/sentry.ts`.
**Cadence:** **on-demand only** — a DSN isn't a credential in
the traditional sense; it grants write-only access to the project.
Worth rotating only if the DSN leaked publicly or the project
needs to be retired.
**Procedure:**

1. In Sentry → Project → Settings → Client Keys (DSN), create a
   new key.
2. Update `SENTRY_DSN` in Vercel; redeploy.
3. After a day, observe events still flowing in Sentry; deactivate
   the old key.

**Verify:**

```sh
# A 5xx triggers a Sentry capture. Use the admin metrics endpoint
# to confirm Sentry is enabled in the running API.
curl -b admin-cookie.txt http://localhost:3001/v1/admin/metrics \
  | jq .sentry
# → { enabled: true, environment: 'production' }
```

**Rollback:**
Re-enable the old DSN in Sentry; revert the Vercel env value.

---

### `RESEND_API_KEY` (future)

**Where it lives:** Vercel env once email sending is wired.
**Who reads it:** `apps/api/src/auth/better-auth.config.ts`
`sendVerificationOTP` callback (currently a `console.log`
placeholder).
**Cadence:** 180 days.
**Procedure:**

1. Resend dashboard → API keys → Create.
2. Vercel env update + redeploy.
3. Send a test OTP to a known address; confirm delivery.
4. Revoke the old key.
5. §3.

**Verify:**

```sh
# Trigger an OTP send to a real inbox you control.
# Check delivery in Resend's logs.
```

**Rollback:**
Reissue the old key from Resend (most providers can revoke ↔
restore). If not, generate a new key and reapply.

---

### Stripe / VNPay (future)

When wired in Phase 7, follow the provider's rotation guidance.
Stripe's standard rotation is "create a restricted secondary key,
swap the live key over, retire the old one after the cutover".
VNPay's procedure differs — document at integration time and add
an entry here.

---

### GitHub Actions secrets — cross-cutting

Any secret stored in `Settings → Secrets and variables → Actions`
is exposed to workflow runs on `main`. Treat as a sensitive store:

- Audit who has admin access (rotation requires admin).
- Don't `echo $SECRET` in workflow logs (GitHub masks `***` but
  printing structure of secrets is a leak risk).
- Mirror the rotation cadence of whatever the secret is — the
  store doesn't have its own cadence, just the contents do.

---

## 3. Last-rotation log

Update each row when you rotate. Old rows stay for the audit
trail.

| Secret                  | Last rotated | Operator | Notes                        |
| ----------------------- | ------------ | -------- | ---------------------------- |
| `AUTH_SECRET`           | _pending_    | _-_      | _initial_                    |
| `DATABASE_URL` password | _pending_    | _-_      | _initial_                    |
| `REDIS_URL`             | _pending_    | _-_      | _initial_                    |
| `BACKUP_DATABASE_URL`   | _pending_    | _-_      | _wait for first prod backup_ |
| `BACKUP_AWS_*`          | _pending_    | _-_      | _wait for first prod backup_ |
| `SENTRY_DSN`            | _pending_    | _-_      | _set when project goes prod_ |
| `RESEND_API_KEY`        | _n/a_        | _-_      | _wired in Phase 7+_          |
| Stripe / VNPay          | _n/a_        | _-_      | _wired in Phase 7+_          |

---

## 4. Emergency rotation

If a secret leaks (public commit, exposed log, suspected breach):

1. **Identify scope.** What was exposed, for how long, who could
   have read it?
2. **Rotate immediately** — skip cadence; the procedure is the
   same as scheduled rotation but compressed.
3. **Invalidate** anything the secret could have produced —
   sessions (truncate `Session`), uploaded files (rotate S3
   bucket policy), open Stripe payment intents (refund + cancel).
4. **Audit** — search `AuditLog` for unusual actor / action /
   target patterns around the exposure window.
5. **Post-mortem** — document in `docs/incidents/`.

Don't wait for a maintenance window if data integrity is at risk.

---

## 5. Vault / centralized store

This doc assumes secrets live in Vercel env + GitHub secrets +
operator shell. A centralized vault (1Password, HashiCorp Vault,
AWS Secrets Manager) makes the procedure easier and the audit
trail richer. **Recommendation:** adopt one before production
traffic. The procedures above stay the same; only the "where it
lives" line changes.

---

## 6. What this policy doesn't cover

- **Encryption keys for backups** — when GPG/age encryption is
  added to `scripts/backup-postgres.sh`, the symmetric key gets
  its own entry here.
- **mTLS certificates** — not currently used.
- **OAuth client secrets** — not currently used.
- **JWT signing keys** — better-auth handles session cookies;
  no separate JWT key.
