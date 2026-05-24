# CLAUDE.md — apps/e2e

Playwright end-to-end suites covering the four PWAs + API.

## Local setup (read this before running the suite)

The suite has a deliberate safety check in `global-setup.ts` that
refuses to truncate a non-local database. If your repo `.env` points
at a shared / remote DB (e.g. Supabase), the suite will abort before
touching it.

One-shot bootstrap from a clean checkout:

```bash
pnpm e2e:setup
```

That script (`scripts/e2e-setup.mjs`):

1. Verifies Docker is on PATH.
2. Brings up `docker-compose.yml` (postgres, redis, minio, minio-init,
   mailhog) with `--wait` so each healthcheck passes before moving on.
3. Runs `prisma migrate deploy` against the local DB.
4. Runs the Prisma seed (idempotent — safe to re-run).
5. Prints the override command for the suite.

After the script finishes, run the suite with the local URLs forced in:

```bash
DATABASE_URL=postgresql://app:app@localhost:5432/app \
REDIS_URL=redis://localhost:6379 \
pnpm turbo test --filter=@repo/e2e
```

PowerShell:

```powershell
$env:DATABASE_URL = "postgresql://app:app@localhost:5432/app"
$env:REDIS_URL = "redis://localhost:6379"
pnpm turbo test --filter=@repo/e2e
```

The `pnpm turbo dev` workflow already targets the same local URLs, so
if you're running both at once you can drop the env prefix.

## Rules

- **One happy-path test per feature**, minimum. Edge cases live in unit tests.
- **Cross-app flows** belong here (e.g., owner posts campaign → admin approves
  → tenant applies → owner accepts). Single-app flows can live here too if
  they're critical (login, pay bill).
- **Real API + DB** during e2e — use `pnpm db:reset` + seed before each suite.
  No mocking the backend.
- **No flakes.** A flaky test gets quarantined or fixed within the same PR.
- **Selectors:** prefer `getByRole` / `getByLabel` / `getByTestId`. Avoid CSS
  selectors tied to Tailwind classes.

## Critical flows (Phase 6 must-have)

- Login for each role
- Owner pays bill end-to-end
- Tenant raises ticket → owner resolves → tenant rates
- Owner posts campaign → admin approves → tenant applies → owner accepts
- Owner books partner → partner completes → settlement + ledger entries
