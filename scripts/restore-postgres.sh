#!/usr/bin/env bash
# Restore a Postgres dump produced by scripts/backup-postgres.sh.
#
# Usage:
#   restore-postgres.sh <key> <target-database-url>
#
#   <key>                 Either an `s3://bucket/path/file.dump.gz` URL or a
#                         bare key under $BACKUP_S3_BUCKET.
#   <target-database-url> postgres://... THIS DATABASE WILL BE OVERWRITTEN.
#
# Safety belt:
#   Refuses to run against a URL whose hostname matches *supabase* or *prod*
#   unless ALLOW_PROD_RESTORE=1 is set. Restores are destructive.

set -euo pipefail

usage() {
  cat <<EOF >&2
Usage: $0 <s3-key-or-url> <target-database-url>

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

# Parse host with the same Node URL parser the e2e safety belt uses, so the
# two checks stay in lockstep.
host="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$target")"
case "$host" in
  *supabase*|*prod*)
    if [[ "${ALLOW_PROD_RESTORE:-0}" != "1" ]]; then
      echo "[restore] refusing — host '$host' looks production-shaped." >&2
      echo "[restore] set ALLOW_PROD_RESTORE=1 to override." >&2
      exit 2
    fi
    echo "[restore] WARNING — ALLOW_PROD_RESTORE=1 set; proceeding against '$host'." >&2
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

echo "[restore] piping into ${host}"
pg_restore \
  --clean --if-exists \
  --no-owner --no-acl \
  --dbname="$target" \
  "$dump"

echo "[restore] done"
