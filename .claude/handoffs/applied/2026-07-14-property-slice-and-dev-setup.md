# Handoff — 2026-07-14 — property-slice-and-dev-setup

> Session that scaffolded the landlord Property/Unit slice, authored + applied
> the first Prisma migration, reconnected the app to a live Supabase (public
> schema), moved dev ports off 3xxx, and reset the seed accounts. Also applied
> the previous (`2026-07-12-house-renting-rewrite`) handoff to the docs. Written
> for a fresh session to review with clean eyes.

---

## 1. What we built

Two things, plus infra. **(a)** The **landlord Property/Unit vertical slice** —
the second domain slice after leases, and the root of the domain graph (leases +
listings hang off a `Unit`). New: `apps/landlord/services/property.service.ts`
(`createProperty` / `listProperties` / `getProperty` / `createUnit`, org-scoped,
ownership asserted after `findUnique`), `app/api/properties/route.ts` (GET+POST),
`app/api/units/route.ts` (POST), `app/(dashboard)/properties/page.tsx` (list),
and `PROPERTY_NOT_FOUND` added to `@repo/shared` `DOMAIN_ERROR_MAP`. **(b)** The
**first Prisma migration for the rewrite** — `20260713042519_init` (21 tables, 17
enums, `public` schema), generated offline via `migrate diff`. Infra: reconnected
`@repo/db` + all apps to a live Supabase on the **public** schema, applied the
migration + seeded, moved all six apps' dev/start ports **3xxx → 61xx**, and
changed seed accounts to `@test.com` / `12345678`.

Branches (all off `main` @ `1aa961b`):
- `feat/landlord-properties` — slice + init migration + 61xx ports + seed change
  (chore/dev-ports merged in). Pushed. HEAD `a028781`.
- `docs/apply-handoff-house-renting-rewrite` — applied the prior handoff; created
  `claude-context/gotchas.md`, trimmed root `CLAUDE.md`. Local only.

---

## 2. New invariants discovered

**a) The Prisma CLI reads `.env` from the CWD (`packages/db/`), not repo root.**
- Rule: `prisma migrate/db/seed/studio` load connection env from
  `packages/db/.env` (via `import "dotenv/config"` in `prisma.config.ts`), **not**
  the repo-root `.env`. That file is the authoritative CLI connection config.
- Enforced: `packages/db/prisma.config.ts` (`datasource.url = DIRECT_URL || DATABASE_URL`).
- Why it matters: a stale `packages/db/.env` pointing at the wrong schema/DB sends
  every migration + seed to the wrong place while the root `.env` looks correct.
  This cost real time this session (P3005, see §3).
- Proposed home: `gotchas.md`.

**b) The runtime pg pool strips the `?schema=` param — app tables MUST be in `public`.**
- Rule: `buildPoolConfig()` deletes `schema` (and `sslmode`) from `DATABASE_URL`,
  so the `@prisma/adapter-pg` client always resolves to the default (`public`)
  search_path at runtime. A `?schema=X` in any app's `.env.local` is silently
  ignored at runtime even though the CLI honors it.
- Enforced: `packages/db/src/index.ts` → `buildPoolConfig()` (`url.searchParams.delete("schema")`).
- Why it matters: CLI-honors-schema + runtime-ignores-schema is exactly how you
  get "table `public.X` does not exist" with data sitting in another schema.
- Proposed home: `gotchas.md` (extends the existing adapter-pg note there).

**c) Dev ports must avoid browser-reserved ports.**
- Rule: Next.js refuses `-p 6000` ("reserved for x11"); pick ports outside the
  Chrome/Next unsafe list (6000, 6665–6669, 6697, …). This project standardized on
  **61xx** (landlord 6100 … vendor 6105).
- Enforced: each `apps/*/package.json` `dev`/`start` scripts.
- Why it matters: `next dev -p 6000` exits non-zero; the app won't start.
- Proposed home: `gotchas.md` (short note) — or leave as the recorded port list in
  root `CLAUDE.md`, which was updated this session.

---

## 3. Gotchas hit during the build

**Stale `packages/db/.env` shadowed the intended connection.**
- Symptom: `prisma migrate deploy` connected to schema `house_renting` and hit
  **P3005 "database schema is not empty"**, even though the root `.env` said public.
- Root cause: leftover smoke-test `packages/db/.env` (+ per-app `.env.local`) from
  the rewrite pointed at `?schema=house_renting`; `dotenv` loads the CWD file.
- Fix: rewrote `packages/db/.env` and every `apps/*/.env.local` to `public`.
- Add to `gotchas.md`? **Yes** (pairs with §2a/§2b).

**`public` was non-empty → P3018 on migrate.**
- Symptom: `Applying migration … Error: P3018 … type "UnitStatus" already exists`.
- Root cause: a prior `db push` had already created objects in `public`; the fresh
  migration collided and was recorded as **failed**, blocking further migrations.
- Fix: `prisma migrate reset --force` (drops+rebuilds `public`, clears the failed
  record), then `npm run db:seed`. Reset only touched `public` (the datasource
  schema); the old `house_renting` schema was left intact.
- Add to `gotchas.md`? **Yes** — the P3005/P3018 recovery path is reusable.

**`migrate diff` emitted a spurious `CREATE SCHEMA "house_renting"`.**
- Symptom: the generated `…_init/migration.sql` began with
  `CREATE SCHEMA IF NOT EXISTS "house_renting";` even though `schema.prisma` has
  zero `house_renting`/`@@schema` references and all objects are unqualified.
- Root cause: not resolved — a Prisma 7 `migrate diff` quirk. Impact was nil (all
  tables unqualified → `public`), but the stray schema was misleading.
- Fix: hand-deleted the two lines; added `migration_lock.toml`.
- Add to `gotchas.md`? **Yes** — "review the generated init migration for stray
  `CREATE SCHEMA`."

**Prisma 7 CLI flag changes.**
- `migrate diff --to-schema-datamodel` was **removed** → use `--to-schema`.
- `migrate reset` **dropped `--skip-seed`** (only `--force`, `--schema`, `--config`).
- Add to `gotchas.md`? **Yes** (short "Prisma 7 CLI deltas" note).

**Prisma's AI-agent consent gate blocks destructive commands.**
- Symptom: `migrate reset` refused with a long "invoked by Claude Code … forbidden
  without explicit consent" message and did nothing.
- Fix: after explicit user consent, re-run with
  `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<exact consent text> … --force`.
- Add to `gotchas.md`? **Yes** (operational note; also true for `migrate dev`/`db push`).

**Next.js port 6000 is reserved (X11).** (See §2c.) Add to `gotchas.md`? Marginal.

---

## 4. Contradictions with existing docs

**Root `CLAUDE.md` migrations rule vs. what actually happened.**
- Existing rule: *"Migrations: hand-written SQL + `prisma migrate deploy` via
  `DIRECT_URL` … Never `migrate dev` / `db push` on the shared DB."*
- Contradiction: the init migration was **generated** via
  `prisma migrate diff --from-empty --to-schema … --script` (then hand-edited),
  not written from scratch; and the target DB already carried a `db push`-origin
  schema, which we recovered from with `migrate reset` (a reset, not a deploy).
- Proposed correction: document the real authoring flow —
  `migrate diff --from-empty --to-schema` to generate → review/trim the SQL →
  `migrate deploy`. Keep "no `db push` on shared/prod" as the target, but
  acknowledge `migrate diff` as the generator.

**Root `CLAUDE.md` port list changed 3xxx → 61xx, but only on `feat`.**
- This session updated the Stack port line to `:6100…:6105` on
  `feat/landlord-properties`. The unmerged `docs/apply-handoff…` branch still shows
  `:3000…:3005` in its own (rewritten) `CLAUDE.md`. When docs lands, reconcile the
  port line to 61xx.

---

## 5. Schema changes

- **Migration:** `packages/db/prisma/migrations/20260713042519_init/migration.sql`
  (+ `migration_lock.toml`). First migration in the repo. 21 tables, 17 enums,
  `public` only. Generated offline via `migrate diff --from-empty --to-schema`.
- **Applied via** `prisma migrate reset --force` (which applied the init
  migration), then `npm run db:seed`. Recorded in `_prisma_migrations` in `public`.
- **`pnpm schema:map`:** not applicable — npm stack, no such script (unchanged from
  the prior handoff).
- **Enums:** the full 17-enum set (no new values beyond the init datamodel); no
  downstream enum-mapping gaps.
- **Not a schema change, but data:** seed now creates `@test.com` users with
  password `12345678`; orgs Maple + Cedar; property/unit/lease/listing/application/
  work-order demo rows.

---

## 6. What should NOT be in the docs

- **Supabase project credentials** (`vfyckhjcuckukkvwzjrh`, DB password, keys in
  `db.txt`) — gitignored, rotate for real use; not doc material.
- **Seed dev credentials** (`@test.com` / `12345678`) — local-dev throwaway.
- **The `house_renting` schema / `DB_SCHEMA` isolation** — reverted scaffolding
  (already excluded by the prior handoff); the `DROP SCHEMA house_renting CASCADE`
  cleanup is still **pending** (see §7).
- **The migrate-reset recovery steps and the Prisma AI-consent env var** — capture
  the *gotcha* (that they exist) but don't enshrine the exact commands as a rule.
- **The specific `.env`/`.env.local` values** — hand-maintained, gitignored.

---

## 7. Open questions (human decides before docs update)

1. **Migration authoring flow** — adopt "`migrate diff` → trim → `migrate deploy`"
   as the documented pattern, replacing/qualifying "hand-written SQL"? (§4)
2. **`DROP SCHEMA house_renting CASCADE`** — still not run. Drop the old schema now
   that `public` is live? (Data there is throwaway.)
3. **Port rule** — document "dev ports = 61xx, avoid browser-reserved 6000" as a
   rule, or just leave the recorded list in `CLAUDE.md`?
4. **Prod migrations** — now that an init migration exists, is prod `migrate deploy`
   the path? Confirm before first prod deploy.
5. **Env setup checklist** — `packages/db/.env` (CLI) + 5 `apps/*/.env.local`
   (runtime) are hand-maintained and gitignored; worth a documented setup checklist
   given how much time the schema-shadowing cost?
6. **Branch bundling** — `feat/landlord-properties` now bundles three concerns
   (feature + dev-ports + seed) via merge. Fine for solo dev; if PR'd, reviewer
   sees mixed concerns. Split before PR?
7. **Next milestone** — still one slice per app (landlord now has two). Properties
   detail/forms, units management, and the other domains (screening, deposits,
   rent-billing UI, maintenance detail) remain unbuilt.
