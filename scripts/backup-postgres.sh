#!/usr/bin/env bash
# Nightly Postgres dump → S3-compatible bucket.
#
# Required env:
#   BACKUP_DATABASE_URL  Full postgres URL — prefer the direct connection,
#                        not the pooler, so pg_dump can hold a long-running
#                        snapshot transaction.
#   BACKUP_S3_BUCKET     Bucket name (no leading s3://).
#
# Optional:
#   BACKUP_S3_PREFIX     Key prefix under the bucket; defaults to bds/postgres.
#   BACKUP_SHORT_SHA     First ~8 chars of git SHA to embed in the filename.
#                        Defaults to "unknown" — workflows fill it from the
#                        GITHUB_SHA env.
#   AWS_*                Standard AWS CLI env (region, key id, secret).
#
# Output:
#   s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}/postgres-${ts}-${sha}.dump.gz
#
# Format:
#   pg_dump --format=custom (binary, parallel-restorable) → gzip -9.
#   --no-owner / --no-acl let us restore into a different role on staging.

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

echo "[backup] dumping → ${out}"
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

echo "[backup] done — s3://${BACKUP_S3_BUCKET}/${key}"
