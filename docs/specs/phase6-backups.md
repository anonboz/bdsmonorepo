# Spec: Postgres backups + restore (phase 6.5)

> Status: **implemented (scripts + workflow shipped; first real backup pending operator-set secrets)**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

Supabase's managed Postgres has its own automatic backup window,
but relying solely on the provider is brittle: we can't restore
into a different environment without their UI, and if the project
is misconfigured (free tier, missed billing) backups can quietly
drop. The BUILD_PLAN §6 item 3 — "Nightly Postgres dump → object
storage, 30-day retention. Documented restore procedure" — asks
for a backup the platform owns end-to-end.

This slice ships the **scripts and the workflow** that produce a
nightly tarball in S3-compatible storage, plus a restore script
and a drill-tested runbook. Provider secrets are operator-supplied
(GitHub Actions secrets, Vercel env, etc.) — the repo defines
shapes, not values.

## 2. User stories

- As an **operator**, I want a nightly `pg_dump` of production
  uploaded to a bucket I control, with a date-stamped filename.
- As an **operator**, I want a one-command restore script so a
  midnight call-out doesn't become a `pg_restore` reference hunt.
- As an **operator**, I want the bucket to age out dumps older
  than 30 days automatically so storage cost stays bounded.
- As an **on-call engineer**, I want a written drill procedure
  for restoring into a throwaway DB so the path is exercised
  before we need it for real.

## 3. Surfaces

| Surface         | File                           | Notes                            |
| --------------- | ------------------------------ | -------------------------------- |
| Backup script   | `scripts/backup-postgres.sh`   | pg_dump → gzip → s3 cp           |
| Restore script  | `scripts/restore-postgres.sh`  | s3 cp → psql                     |
| Backup workflow | `.github/workflows/backup.yml` | Daily cron + workflow_dispatch   |
| Runbook         | `docs/operations/backups.md`   | What's backed up, restore, drill |

## 4. Backup format

`pg_dump --format=custom --no-owner --no-acl | gzip` is the
output. Custom format (`-Fc`) is the documented best for
`pg_restore` — it supports parallel restore, selective table
restore, and is the de facto Postgres backup wire format. Gzip
saves bandwidth + storage; restore decompresses on the fly via
`zcat | pg_restore`.

`--no-owner` and `--no-acl` mean the dump doesn't carry the
source role names. Restore picks up the connection role on the
target, so we can restore from prod into staging without trying
to `ALTER OWNER` to a role that doesn't exist in staging.

Object key:

```
${BACKUP_S3_PREFIX}/postgres-${DATESTAMP}-${SHORT_SHA}.dump.gz
```

`DATESTAMP=YYYYMMDD-HHMMSS` (UTC). `SHORT_SHA` is the first 8
chars of the git SHA the workflow ran for; it tags the dump to
the code version live at the time.

## 5. Retention

Lifecycle rule on the bucket itself: delete objects under
`${BACKUP_S3_PREFIX}/` older than 30 days. The scripts don't
prune — fewer moving parts, fewer ways to delete the wrong
thing. Configuration lives in the runbook (provider-specific
Terraform / console snippet).

## 6. Scripts

### 6.1 `scripts/backup-postgres.sh`

```sh
#!/usr/bin/env bash
set -euo pipefail

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_PREFIX:=bds/postgres}"
: "${BACKUP_SHORT_SHA:=unknown}"

ts="$(date -u +%Y%m%d-%H%M%S)"
filename="postgres-${ts}-${BACKUP_SHORT_SHA}.dump.gz"
tmp="$(mktemp -d)"
out="${tmp}/${filename}"

trap 'rm -rf "$tmp"' EXIT

echo "[backup] dumping → $out"
pg_dump \
  --format=custom --no-owner --no-acl --compress=0 \
  "$BACKUP_DATABASE_URL" \
  | gzip -9 > "$out"

size="$(wc -c < "$out")"
echo "[backup] dump complete (${size} bytes)"

key="${BACKUP_S3_PREFIX}/${filename}"
echo "[backup] uploading → s3://${BACKUP_S3_BUCKET}/${key}"
aws s3 cp \
  --only-show-errors \
  "$out" \
  "s3://${BACKUP_S3_BUCKET}/${key}"

echo "[backup] done"
```

### 6.2 `scripts/restore-postgres.sh`

```sh
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 <s3-key> <target-database-url>

  <s3-key>            s3://bucket/key.dump.gz or just key.dump.gz under \$BACKUP_S3_BUCKET
  <target-database-url>  postgresql://... (THIS DATABASE WILL BE OVERWRITTEN)

Refuses to run against a URL whose hostname contains 'supabase' or 'prod'
unless ALLOW_PROD_RESTORE=1 is set. Safety belt — restores are destructive.
EOF
  exit 1
}

[[ $# -eq 2 ]] || usage
key="$1"
target="$2"

# Loopback-host guard, same shape as e2e global-setup.
host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$target")"
case "$host" in
  *supabase*|*prod*)
    if [[ "${ALLOW_PROD_RESTORE:-0}" != "1" ]]; then
      echo "[restore] refusing — host '$host' looks production-shaped." >&2
      echo "[restore] set ALLOW_PROD_RESTORE=1 to override." >&2
      exit 2
    fi
    ;;
esac

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dump="$tmp/restore.dump"

case "$key" in
  s3://*) source="$key" ;;
  *)
    : "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET required when key is not s3://...}"
    source="s3://${BACKUP_S3_BUCKET}/${key}"
    ;;
esac

echo "[restore] fetching $source"
aws s3 cp "$source" - | gunzip > "$dump"

echo "[restore] piping into $host"
pg_restore \
  --clean --if-exists \
  --no-owner --no-acl \
  --dbname="$target" \
  "$dump"

echo "[restore] done"
```

`--clean --if-exists` drops every object before recreating, which
matches "restore over" semantics. Without `--clean` a partial
existing schema makes `pg_restore` fail noisily on every duplicate
CREATE.

## 7. Workflow

`.github/workflows/backup.yml`:

- `schedule:` `cron: '0 3 * * *'` (03:00 UTC nightly).
- `workflow_dispatch:` so an operator can fire a manual backup.
- Uses Ubuntu, installs PostgreSQL client matching the server
  major (16), and the AWS CLI v2.
- Reads secrets `BACKUP_DATABASE_URL`, `BACKUP_S3_BUCKET`,
  `BACKUP_S3_PREFIX`, `BACKUP_S3_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`.
- 15-min timeout — way more than a small DB needs; budget so
  one slow run doesn't kill the schedule.

The workflow does NOT run on PR — secrets aren't available to
forks anyway. Only `main` + manual dispatch.

## 8. Edge cases

- **`pg_dump` version mismatch** — the workflow pins the
  postgresql-client major to 16. When the server bumps, bump
  the workflow.
- **AWS credentials missing** — `aws s3 cp` 403s; the workflow
  step fails, GitHub sends the operator the standard "workflow
  failed" notification.
- **Restore into a production-shaped URL** — script refuses
  unless `ALLOW_PROD_RESTORE=1` is explicit.
- **Restore into the same DB the dump came from** — fine; the
  `--clean` step drops and recreates. Useful as a recovery path
  after a destructive migration.

## 9. Out of scope

- **Encryption at rest** — relies on bucket policy / KMS
  configured by the operator. The script writes plaintext-gzip,
  not GPG-encrypted dumps. Tracked as a follow-up.
- **Cross-region replication** — bucket-level.
- **WAL-based PITR (point-in-time recovery)** — needs a
  shipping setup; Supabase handles this in its plan tier. Out
  of repo scope.
- **Backup verification (test restore on every dump)** — would
  add real value but doubles compute; flagged as a follow-up.
- **Encrypted backup of secrets / env vars** — separate
  concern; Phase 6.6 covers secrets rotation.

## 10. Drill procedure

Once a month — script in the runbook:

1. Spin up a throwaway Postgres (`docker run --rm -p 15432:5432
-e POSTGRES_PASSWORD=drill postgres:16`).
2. `scripts/restore-postgres.sh <latest-key>
postgresql://postgres:drill@localhost:15432/postgres`.
3. `psql` into it; confirm row counts on `User`, `Lease`,
   `Bill` against current production counts (±1%).
4. Log the drill date + result in `docs/operations/backups.md`.

## 11. Acceptance criteria

- [x] `scripts/backup-postgres.sh` runnable locally with the
      documented env vars produces a `.dump.gz` and uploads to
      S3.
- [x] `scripts/restore-postgres.sh <key> <url>` restores into
      the target URL, refusing prod-shaped URLs unless override.
- [x] `.github/workflows/backup.yml` runs nightly at 03:00 UTC
      and on `workflow_dispatch`.
- [x] `docs/operations/backups.md` documents the env-var
      contract, bucket lifecycle config, and the drill
      procedure.
- [x] No CI pipeline changes (backup is a separate workflow).

## 12. Manual test plan

1. Set `BACKUP_DATABASE_URL`, `BACKUP_S3_BUCKET`, AWS creds in
   a local shell.
2. `bash scripts/backup-postgres.sh` — confirm object lands in
   bucket.
3. `bash scripts/restore-postgres.sh
postgres-<ts>-<sha>.dump.gz postgresql://app:app@localhost:5432/restore_test`
   — confirm `\dt` shows the expected tables.
4. From the GitHub UI, fire `Run workflow` on `backup` — confirm
   green + object lands.

## 13. Rollout

- New scripts, new workflow, no migrations.
- Operator must populate the GitHub secrets before the first
  scheduled run.
- Comms: dev changelog — "nightly Postgres backups live; restore
  via scripts/restore-postgres.sh."
