# CLAUDE.md — @repo/db

Prisma schema, generated client, migrations, and seed. **Single source of truth**
for the data model.

## Rules

- **No other package writes migrations.** All schema changes happen here.
- **Forward-only migrations.** Never edit a shipped migration. Add a new one.
- **Every table has** `id` (cuid2), `createdAt`, `updatedAt`.
- **Soft-delete via `deletedAt`** only when the deletion needs to be reversible
  (leases, users, content). Hard-delete otherwise.
- **Money:** integer minor units + `currency` column. No `Decimal`/`Float`
  columns for money.
- **Enums in `packages/shared`** (Zod) mirror Prisma enums. Keep them in sync.
  Adding a value also requires updating any runtime branch that maps from the
  enum (worker fan-outs, dispatch decision trees, audit-action maps) —
  TypeScript catches switch-statement misses but not nullable filter shapes.

## Workflow

1. Edit `prisma/schema.prisma`.
2. `pnpm db:migrate:dev --name <slug>` — creates a migration and applies it.
3. Update Zod enums/types in `packages/shared` if you changed an enum.
4. Update seed script if the change affects baseline data.
5. Bump TS types across the repo: `pnpm typecheck`.

## When to break the rules

You don't. If you really need to edit a migration, that's a separate human-review
PR with a written reason.
