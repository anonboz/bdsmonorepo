# @repo/db

Prisma schema, generated client, migrations, seed. **Single source of truth** for
the data model.

## Local workflow

```bash
# Start Postgres
docker compose up -d postgres

# First-time setup (also runs after schema edits)
pnpm --filter @repo/db db:migrate:dev

# Reset + reseed
pnpm --filter @repo/db db:reset

# Just (re)seed
pnpm --filter @repo/db db:seed
```

## Adding / changing a model

1. Edit `prisma/schema.prisma`.
2. `pnpm --filter @repo/db db:migrate:dev --name <slug>` — generates a migration
   and applies it.
3. If you added or changed an enum, update the mirror in `packages/shared/src/enums`.
4. Update the seed if the change affects baseline data.
5. Re-typecheck the repo: `pnpm typecheck`.

## Rules

- **Forward-only migrations.** Never edit a shipped migration; add a new one.
- **Every model has** `id` (cuid2), `createdAt`, `updatedAt`. Soft-delete only
  where reversibility matters (`deletedAt`).
- **Money: integer minor units + `currency` (CHAR(3))**. No floats, no Decimal.
- **Enums mirror `packages/shared/src/enums`.** Don't drift.
