# Gotchas

Non-obvious traps that cost real time. One entry per trap — read before touching
the subsystem.

## Database / `@repo/db` pg pool

- **Strip `sslmode` from the URL; set `ssl` explicitly.** node-pg ≥8.13 upgrades
  `sslmode=require` to `verify-full` and rejects Supabase's self-signed chain, so
  every connection fails at runtime. `buildPoolConfig()` in `packages/db/src/index.ts`
  deletes `sslmode` from `DATABASE_URL` and passes `ssl: { rejectUnauthorized: false }`
  for managed Postgres. Never hand a raw `sslmode=require` string to `pg.Pool`.

- **`DATABASE_URL` must be set at BUILD time, not just runtime.** `@repo/db`
  builds its pool at module load, and `next build` evaluates route modules while
  collecting page data, so any build that imports it — local, CI, Vercel — needs
  `DATABASE_URL` set (a dummy value is enough for CI). Missing → the build dies
  with `[@repo/db] DATABASE_URL is not set…` (formerly a cryptic `Invalid URL`).
  CI sets it in `.github/workflows/ci.yml`. On Vercel it must be set **per
  project** and in the **Production** scope — a Preview-only var still fails
  production builds.
  <!-- TODO: if @repo/db's pool is made lazy, this rule dissolves. -->

- **`@prisma/adapter-pg` hard-qualifies the default schema at generate time.**
  `search_path` and pool `options` do NOT redirect it (Supabase's pooler swallows
  startup `options` anyway), so `The table public.X does not exist` persists even
  with `search_path` set. Keep everything in the DB's `public` schema.
  Second cause, same symptom: `buildPoolConfig()` also deletes `?schema=` from
  `DATABASE_URL`, so a `?schema=X` the Prisma CLI honors is silently ignored at
  runtime — migrations/seed write to `X` while the app reads `public`.

- **The Prisma CLI and the apps read different env files.** Prisma CLI commands
  (migrate, studio) and `db:seed` run from `packages/db/` and load
  `packages/db/.env` (`import "dotenv/config"`), **not** the root `.env`; the
  apps read `apps/*/.env.local`. A stale `packages/db/.env` sends every
  migration + seed to the wrong DB/schema while the root `.env` looks correct
  (symptom: P3005 "database schema is not empty"). Keep all of them in step.

- **Review `prisma migrate diff` output before deploying.** Prisma 7 has
  emitted a stray `CREATE SCHEMA IF NOT EXISTS "house_renting";` with no
  reference in `schema.prisma`. Delete stray schema DDL / qualifiers — every
  object must land in `public`.

- **`PrismaClientValidationError: Unknown field` after a schema change.** The
  running `next dev` holds the old generated client in memory; `prisma generate`
  only updates disk. Restart the dev server after `prisma generate` / a migration.

- **Seed `reset()` must explicitly delete every org-less table.** Deleting
  organizations only cascades to org-owned rows. Global tables
  (`PaymentMethodCatalog`, `UtilityRateBound`) and nullable-org rows (system
  `Announcement` with `organizationId = null`) survive and duplicate on reseed.
  Add a `deleteMany()` for any new global table.

## Auth / sessions

- **Stale NextAuth JWT after a reseed → empty pages, no 401.** `db:seed` rotates
  user IDs; the browser's JWT still decodes, but its `userId` no longer exists, so
  every `userId`-scoped query returns empty. Sign out and back in after a reseed.

## Payments

- **`PaymentMethodKey` ≠ Prisma `PaymentMethod`.** Catalog keys come from
  `PAYMENT_METHOD_KEYS` in `@repo/shared` (`bank_transfer | cash | card | ewallet |
points`); `Payment.method` is the older Prisma enum (`card | bank_transfer | ach |
cash | other`). Only `MANUAL_PAYMENT_METHODS` (`bank_transfer`, `cash`) exist in
  both and may be written to `Payment.method`. Enabling e.g. `ewallet` in the catalog
  and writing it to a `Payment` fails at the DB. Readers filter with
  `isPaymentMethodKey`; `reportSchema` is `z.enum(MANUAL_PAYMENT_METHODS)`.
  <!-- TODO: remove once the next payment rail is added and the two vocabularies
       are unified (extend the enum or make Payment.method reference the catalog). -->

## Next.js

- **Session/Prisma pages need `export const dynamic = "force-dynamic"`.** Any
  server component that reads the session or hits Prisma cannot be statically
  prerendered — without it Next tries at build and throws `DynamicServerError`.

- **Server → client props must be serializable: pass rendered elements, not
  component references.** A Server Component layout passing `icon: Home` (a
  lucide `forwardRef` object) to a `@repo/ui` client component such as
  `MobileNav` throws "Only plain objects can be passed to Client Components".
  Type such props as `React.ReactNode` and render first
  (`icon: <Home className="h-4 w-4" />`).

- **`useSearchParams` needs a `<Suspense>` boundary**, or the page's prerender
  fails with the CSR-bailout error.

- **`typedRoutes` (tenant app only).** Two traps:
  - A brand-new page isn't a known route until typegen runs —
    `tsc` fails with `"/x" is not assignable to RouteImpl<"/x">` even with
    `next dev` running. `.next/types/routes.d.ts` regenerates on `next dev`
    start / `next build` / `next typegen`, not on file creation. Run
    `npx next typegen` in `apps/tenant`.
  - A runtime href (e.g. `callbackUrl` from `useSearchParams()`) isn't statically
    a `Route`; `router.push(x)` fails the build. Cast `as Route` (from `next`) at
    that boundary.

## Deployment (Vercel, shared-repo monorepo)

- **Set each project's `rootDirectory = apps/<app>` explicitly.** `vercel link`
  leaves it `null`, which builds from the repo root and fails every Git deploy.

- **Run `vercel git connect` with the repo URL, not from a subdir.** From
  `apps/<app>` it fails with `No local Git repository found` (`.git` is at the
  repo root). Pass the repo URL explicitly.

## Supabase Storage

- **Uploads go through server-only `apps/<app>/lib/storage.ts`** with
  `SUPABASE_SERVICE_ROLE_KEY`. Never construct a Supabase client in client code
  or expose the key with a `NEXT_PUBLIC_` prefix — the service-role key bypasses
  all storage policies.

- **Buckets are provisioned manually.** `listing-photos`, `meter-readings` and
  `inspection-photos` (see `apps/landlord/lib/storage.ts`) are public buckets
  created by hand with the service-role key; a fresh Supabase project needs them
  created or uploads fail.
  <!-- TODO: remove once bucket provisioning is scripted or migrated. -->

- **Public URLs keep serving deleted objects.** The CDN edge cache returns 200 for
  a deleted object's public URL. Verify deletes with
  `storage.from(bucket).list()` (service-role client), not by fetching the URL.

## Tooling

- **The pre-commit hook checks Prettier across the whole repo**, not just staged
  files (`.husky/pre-commit` runs `prettier --check --cache "**/*.{ts,…,md}"`).
  Unformatted unstaged or untracked WIP blocks the commit. Run
  `npx prettier --write <file>` on what it names.
