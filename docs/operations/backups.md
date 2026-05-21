# Backups runbook

How the nightly Postgres backup works, how to restore from one,
and the drill procedure that keeps us from learning at the worst
possible time.

## 1. What's backed up

`scripts/backup-postgres.sh` calls `pg_dump --format=custom
--no-owner --no-acl` and gzips the output. That captures:

- Every table, including the entire Better-Auth `Session`,
  `Account`, `Verification` set
- Every Prisma migration in `_prisma_migrations`
- Every audit log row (`AuditLog`)
- Every domain row (houses, units, leases, bills, tickets,
  campaigns, applications, partners, services, service-jobs,
  ledger entries, ratings, notifications)

It does **not** capture:

- Files stored outside Postgres — S3 photos, receipt PDFs (those
  live in object storage already and need their own bucket
  versioning + lifecycle).
- Redis state — by design ephemeral.

## 2. Cadence + storage

| Setting     | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| Schedule    | `0 3 * * *` UTC (nightly, via `.github/workflows/backup.yml`)    |
| Manual fire | `gh workflow run "Backup — Postgres nightly dump"`               |
| Format      | `pg_dump -Fc` + gzip                                             |
| Object key  | `${BACKUP_S3_PREFIX}/postgres-${YYYYMMDD-HHMMSS}-${sha}.dump.gz` |
| Retention   | 30 days, enforced by **bucket lifecycle policy** (§4)            |
| Encryption  | Operator-configured (KMS / SSE-S3). Scripts ship plaintext-gz.   |

## 3. Required GitHub Actions secrets

Set under **Settings → Secrets and variables → Actions** of the
repository:

| Secret                         | Example                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| `BACKUP_DATABASE_URL`          | `postgresql://user:pass@db.HOST.supabase.co:5432/postgres?sslmode=require` |
| `BACKUP_S3_BUCKET`             | `bds-prod-backups`                                                         |
| `BACKUP_S3_PREFIX`             | `bds/postgres`                                                             |
| `BACKUP_S3_REGION`             | `ap-southeast-1`                                                           |
| `BACKUP_AWS_ACCESS_KEY_ID`     | IAM key with `s3:PutObject` on the prefix                                  |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | matching secret                                                            |

**Prefer the direct Postgres connection** in `BACKUP_DATABASE_URL`,
not the pooler — `pg_dump` holds a snapshot transaction the
pooler may break.

The IAM policy can be as tight as:

```jsonc
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::bds-prod-backups/bds/postgres/*",
    },
  ],
}
```

Restore credentials live separately (an SRE laptop / shared
1Password vault). Don't reuse the backup writer key for restores
— restores can read + restore != backups can only write.

## 4. Bucket lifecycle policy

The scripts don't prune. A lifecycle rule on the bucket deletes
objects under the prefix after 30 days.

AWS S3 (Terraform-shaped):

```hcl
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    id     = "expire-postgres-dumps"
    status = "Enabled"
    filter { prefix = "bds/postgres/" }
    expiration { days = 30 }
  }
}
```

Or via the console: **Bucket → Management → Lifecycle rules → Add
rule → Filter prefix `bds/postgres/` → Expire current versions
after 30 days**.

Verify it's actually applied: `aws s3api
get-bucket-lifecycle-configuration --bucket bds-prod-backups`.

## 5. Restore procedure

```sh
# 1. Find the dump key
aws s3 ls "s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/" --recursive | tail

# 2. Spin up a throwaway target (or use staging)
docker run --rm -d --name restore-pg \
  -p 15432:5432 \
  -e POSTGRES_PASSWORD=drill \
  postgres:16

# 3. Restore
BACKUP_S3_BUCKET=bds-prod-backups \
  scripts/restore-postgres.sh \
    bds/postgres/postgres-20260520-030000-deadbeef.dump.gz \
    postgresql://postgres:drill@localhost:15432/postgres

# 4. Smoke-test
psql postgresql://postgres:drill@localhost:15432/postgres \
  -c 'SELECT COUNT(*) FROM "User";'

# 5. Tear down
docker stop restore-pg
```

The restore script **refuses** to run against a URL whose host
matches `*supabase*` or `*prod*` unless `ALLOW_PROD_RESTORE=1`
is set. Set it only when you genuinely intend to overwrite
production — which is almost never.

### Recovering after a destructive migration

1. Fire the workflow manually before the migration (manual
   dispatch is what `workflow_dispatch` is for).
2. If the migration corrupts data, restore the dump back into the
   same DB with `ALLOW_PROD_RESTORE=1` — `pg_restore --clean
--if-exists` drops every object and recreates from the dump.

## 6. Drill — once a month

Logged here. Goal: confirm a 30-day-old dump still restores
cleanly into a fresh Postgres.

| Date      | Operator | Key          | Result    | Notes |
| --------- | -------- | ------------ | --------- | ----- |
| _pending_ | _SRE_    | _next-month_ | _to-fill_ | _-_   |

Procedure:

1. Pick the oldest dump still in the bucket (28-30 days old).
2. Run §5 against a throwaway Postgres 16 container.
3. Spot-check row counts on `User`, `Lease`, `Bill`. Expect them
   within ~1% of what production currently shows.
4. Add a row to the table above.

## 7. What can go wrong + how to spot it

| Symptom                                                     | Likely cause                                            | Fix                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Workflow red — `aws: command not found`                     | Ubuntu image without AWS CLI v2                         | Add an explicit install step.                          |
| Workflow red — `pg_dump: server version (X) does not match` | Server major bumped past the pinned 16                  | Bump `postgresql-client-XX` in `backup.yml`.           |
| Workflow green, no new object in bucket                     | Wrong prefix, wrong bucket, IAM                         | Re-verify secrets via §3 checklist.                    |
| Dump size suddenly halves                                   | A worker truncated tables                               | Pull the previous dump, diff with `pg_restore --list`. |
| Drill restore complains about FK violations                 | Custom-format dumps shouldn't — could be a partial dump | Re-fetch, re-try; if persistent, escalate.             |

## 8. What's NOT covered

- **Point-in-time recovery (PITR)** — needs WAL shipping; the
  Supabase plan tier handles it, the scripts don't.
- **Cross-region replication** — bucket-level concern.
- **Encrypted dumps (GPG/age)** — open follow-up.
- **Test restore on every dump (verification)** — would double
  CI minutes; revisit when prod traffic justifies it.
- **Object storage (S3) backups for user-uploaded photos** —
  separate slice (lives outside Postgres).
