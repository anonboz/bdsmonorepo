#!/usr/bin/env node
// Phase 12.5 — `pnpm e2e:setup`
//
// One-shot bootstrap for the Playwright suite in apps/e2e. The suite has
// a deliberate safety check (apps/e2e/global-setup.ts:assertLocalDatabase)
// that refuses to truncate a non-local DB, so contributors landing in a
// fresh checkout — or one with a remote DATABASE_URL in .env — need a
// reliable way to get a local Postgres + Redis + MinIO up and migrated.
//
// What this does:
//   1. Verifies `docker` is on PATH.
//   2. Brings up the `docker-compose.yml` stack (postgres + redis + minio
//      + minio-init + mailhog) with `--wait` so each service's healthcheck
//      reports healthy before we move on.
//   3. Runs `prisma migrate deploy` against the local DB.
//   4. Runs the seed (idempotent — Prisma seed is structured to upsert).
//   5. Prints the override command the runner can paste to actually
//      execute the e2e suite.
//
// The script does NOT mutate the caller's `.env` — it always passes
// `DATABASE_URL=postgresql://app:app@localhost:5432/app` (the local
// docker-compose URL) to the prisma + seed subprocesses, so a caller
// whose `.env` points at a remote DB stays safe.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const LOCAL_DATABASE_URL = 'postgresql://app:app@localhost:5432/app';
const LOCAL_REDIS_URL = 'redis://localhost:6379';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function step(msg) {
  console.log(`${colors.bold}${colors.cyan}▸${colors.reset} ${msg}`);
}

function ok(msg) {
  console.log(`  ${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg) {
  console.error(`  ${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function note(msg) {
  console.log(`  ${colors.dim}${msg}${colors.reset}`);
}

/** Run a command synchronously, inheriting stdio. Exit 1 on failure. */
function run(cmd, args, opts = {}) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: opts.silent ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`${cmd} failed to spawn: ${result.error.message}`);
  if (result.status !== 0) {
    if (opts.silent) {
      process.stderr.write(result.stderr?.toString() ?? '');
    }
    fail(`${cmd} ${args.join(' ')} exited with ${result.status}`);
  }
  return result;
}

step('Checking Docker is on PATH…');
const dockerCheck = spawnSync('docker', ['--version'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: process.platform === 'win32',
});
if (dockerCheck.status !== 0) {
  fail(
    'Docker not found. Install Docker Desktop (Windows / macOS) or the docker CLI (Linux), ' +
      'start the daemon, then re-run `pnpm e2e:setup`.',
  );
}
ok(dockerCheck.stdout.toString().trim());

step('Bringing up docker-compose stack (postgres / redis / minio / mailhog)…');
note('First boot pulls images and primes volumes — can take a minute.');
run('docker', ['compose', 'up', '-d', '--wait']);
ok('All services healthy.');

step('Applying Prisma migrations to the local DB…');
run('pnpm', ['--filter', '@repo/db', 'db:migrate:deploy'], {
  env: { DATABASE_URL: LOCAL_DATABASE_URL },
});
ok('Migrations applied.');

step('Seeding baseline data…');
run('pnpm', ['--filter', '@repo/db', 'db:seed'], {
  env: { DATABASE_URL: LOCAL_DATABASE_URL },
});
ok('Seed complete.');

console.log();
console.log(`${colors.bold}${colors.green}✓ e2e environment is ready.${colors.reset}`);
console.log();
console.log('Run the e2e suite against the local stack with:');
console.log();
console.log(`  ${colors.cyan}DATABASE_URL=${LOCAL_DATABASE_URL} \\${colors.reset}`);
console.log(`  ${colors.cyan}REDIS_URL=${LOCAL_REDIS_URL} \\${colors.reset}`);
console.log(`  ${colors.cyan}pnpm turbo test --filter=@repo/e2e${colors.reset}`);
console.log();
note(
  'PowerShell:  $env:DATABASE_URL = "' +
    LOCAL_DATABASE_URL +
    '"; $env:REDIS_URL = "' +
    LOCAL_REDIS_URL +
    '"; pnpm turbo test --filter=@repo/e2e',
);
note('See apps/e2e/CLAUDE.md for the full runbook.');
