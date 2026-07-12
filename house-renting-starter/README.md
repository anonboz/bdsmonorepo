# Monorepo Template — House-Renting Platform

> Exported from the `dcmonorepo` structure as a reusable skeleton. It captures the
> **layout, tooling, and conventions** — not the coffee-shop domain. Everything
> below is the same architecture, re-mapped to house renting.

---

## 0. What's in this starter (lift-out map)

This folder mirrors the real monorepo tree — copy files straight to the paths
shown. `landlord` is the worked example app; clone its shape per app.

```
house-renting-starter/
├── README.md                                  this file (architecture + conventions)
├── CLAUDE.md                        →  <repo>/CLAUDE.md            (root agent guardrails)
├── docs/ai-context-structure.md               how to build claude-context/ + per-app CLAUDE.md
├── packages/db/
│   ├── prisma/schema.prisma         →  packages/db/prisma/schema.prisma   (17 models, validated)
│   ├── prisma.config.ts             →  packages/db/prisma.config.ts       (Prisma 7 CLI config)
│   └── src/index.ts                 →  packages/db/src/index.ts           (pooled client + re-exports)
└── apps/landlord/
    ├── app/globals.css              →  apps/<app>/app/globals.css         (Tailwind 4 theme)
    ├── app/api/leases/route.ts      →  apps/<app>/app/api/leases/route.ts (thin route)
    ├── lib/api.ts                   →  apps/<app>/lib/api.ts              (envelope + error mapper)
    ├── lib/session.ts               →  apps/<app>/lib/session.ts          (JWT session + org scope)
    └── services/lease.service.ts    →  apps/<app>/services/lease.service.ts (fat service)
```

The `Lease` route→service→lib files are a complete vertical slice demonstrating
the envelope, the multi-tenant guard, and role gating — clone it per feature.

---

## 1. Stack (carry over as-is)

- **Turborepo** + **npm workspaces** (`apps/*`, `packages/*`), Node 20+, `npm@10`.
- **Next.js 16** (App Router, TypeScript strict) — one Next app per audience.
- **Prisma 7 + Postgres** (Supabase-hosted works well) via a single shared `@repo/db` package with a pooled client.
- **NextAuth 4** (JWT sessions, per-app cookie names).
- **Base UI / shadcn + Tailwind 4** shared through `@repo/ui`.
- **Zod 4** for all validation, **TanStack Query/Table** on the client.
- **Serwist** PWA (offline) for the field-facing apps.
- **Pusher** (Channels + Beams) for realtime/notifications via `@repo/realtime`.
- Packages are **consumed as raw TypeScript** (no build step) via each package's
  `exports` map pointing at `src/…` — Turbo + `tsc --noEmit` handle correctness.

---

## 2. Top-level layout

```
house-renting/
├── package.json            # workspaces: ["apps/*","packages/*"], turbo devDep
├── turbo.json              # task graph (build/dev/lint/typecheck/db:generate)
├── tsconfig.json           # root base config (strict, bundler resolution)
├── package-lock.json
├── CLAUDE.md               # root guardrails/conventions (optional but recommended)
├── apps/
│   ├── landlord/           # :3000  owner dashboard (properties, leases, rent, maintenance)
│   ├── tenant/             # :3001  renter app (browse, apply, pay rent, requests) — PWA
│   ├── agent/              # :3002  leasing/property-manager (showings, screening, applications)
│   ├── listings/           # :3003  public marketing + search site (SSR/SEO)
│   ├── admin/              # :3004  GLOBAL cross-org console (users, config, feature flags)
│   └── vendor/             # :3005  maintenance contractor app (work orders) — PWA
├── packages/
│   ├── db/                 # @repo/db          Prisma schema + client (server-only)
│   ├── domain/             # @repo/domain      business logic, namespaced (domain → db only)
│   ├── domain-events/      # @repo/domain-events  typed events + progress/notification engine
│   ├── ui/                 # @repo/ui          Base UI/shadcn primitives + Tailwind theme
│   ├── realtime/           # @repo/realtime    Pusher wrapper (channels/auth/publish)
│   ├── offline/            # @repo/offline     IndexedDB queue/cache/sync for PWAs
│   ├── rate-limit/         # @repo/rate-limit  shared rate limiting
│   ├── shared/             # @repo/shared      framework-agnostic types/utils/zod schemas
│   └── shared-utils/       # @repo/shared-utils feature-flag checker, formatters, helpers
└── scripts/
    └── db/                 # one-off DB scripts (NOT in packages/db — see §7)
```

Pick the app set that fits you; 6 is illustrative. The load-bearing split is
**one Next app per audience** + **one global admin app** + **shared packages**.

---

## 3. Workspace & task wiring

**Root `package.json`**
```json
{
  "name": "house-renting",
  "private": true,
  "packageManager": "npm@10.8.3",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev:landlord": "cd apps/landlord && npm run dev",
    "build:landlord": "npm run build --workspace=landlord",
    "typecheck:landlord": "npm run typecheck --workspace=landlord",
    "db:generate": "npm run db:generate --workspace=packages/db",
    "db:studio": "npm run db:studio --workspace=packages/db"
  },
  "devDependencies": { "turbo": "2.10.1", "typescript": "^5.8.3" }
}
```

**`turbo.json`** — the important edges: every app `build` depends on `^build`
and `^db:generate` (so the Prisma client is generated first), and lists the env
vars builds are allowed to read.
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":       { "dependsOn": ["^build", "^db:generate"],
                     "outputs": [".next/**", "!.next/cache/**"],
                     "env": ["DATABASE_URL","DIRECT_URL","NEXTAUTH_SECRET","NEXTAUTH_URL","PUSHER_APP_ID","PUSHER_KEY","PUSHER_SECRET"] },
    "dev":         { "cache": false, "persistent": true },
    "lint":        { "outputs": [] },
    "typecheck":   { "dependsOn": ["^build"], "outputs": [] },
    "db:generate": { "cache": false, "outputs": ["node_modules/.prisma/**"] }
  }
}
```

**TypeScript** — root `tsconfig.json` is the base (`strict`, `moduleResolution:
"bundler"`, `noEmit`). Each app extends it in spirit and adds the Next plugin +
`@/*` path alias:
```jsonc
// apps/<app>/tsconfig.json
{
  "compilerOptions": {
    "strict": true, "noEmit": true, "module": "esnext",
    "moduleResolution": "bundler", "jsx": "react-jsx",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

---

## 4. Anatomy of one app (Next.js App Router)

```
apps/landlord/
├── package.json          # depends on @repo/* via "*" (workspace) + next/react/zod/...
├── next.config.ts
├── tsconfig.json
├── middleware.ts         # auth gate (decode JWT), maintenance-mode, matcher excludes
├── postcss.config.mjs    # Tailwind
├── components.json       # shadcn config
├── vercel.json
├── .env.example
├── CLAUDE.md             # per-app guardrails (session shape, data rules, routes)
├── app/
│   ├── (auth)/           # login / forgot-password / reset (public)
│   ├── (dashboard)/      # authenticated layout group
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── properties/   # feature route → page.tsx (+ [id]/…)
│   │   ├── leases/
│   │   ├── rent/
│   │   └── maintenance/
│   ├── api/              # route handlers: thin, parse+auth+call service
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── properties/route.ts
│   │   └── leases/[id]/route.ts
│   ├── layout.tsx        # root layout (fonts, providers, PWA install shim)
│   ├── globals.css
│   └── manifest.ts       # PWA (tenant/vendor apps)
├── services/             # FAT business logic — one file per domain
│   ├── property.service.ts
│   ├── lease.service.ts
│   ├── rent.service.ts
│   └── maintenance.service.ts
├── components/           # app-specific UI (compose @repo/ui primitives)
└── lib/                  # app-context (getSession/storeId), api-error, utils
```

**App `package.json`** dependencies reference workspaces with `"*"`:
```jsonc
"dependencies": {
  "@repo/db": "*", "@repo/domain": "*", "@repo/ui": "*",
  "@repo/shared": "*", "@repo/shared-utils": "*", "@repo/realtime": "*",
  "next": "16.2.2", "next-auth": "^4", "react": "^19", "zod": "^4",
  "@tanstack/react-query": "^5", "lucide-react": "*", "date-fns": "^4"
}
```
Scripts: `dev` (`next dev -p <port>`), `build` (`prisma generate --schema=../../packages/db/prisma/schema.prisma && next build`), `typecheck` (`tsc --noEmit`).

---

## 5. Anatomy of the shared packages

Each package is a folder with a `package.json` whose `exports` point directly at
TypeScript source — **no compile step**:

```jsonc
// packages/db/package.json
{
  "name": "@repo/db",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./services/rent": "./src/services/rent.service.ts"   // optional subpaths
  },
  "scripts": { "db:generate": "prisma generate", "db:studio": "prisma studio" },
  "dependencies": { "@prisma/client": "7.6.0", "@prisma/adapter-pg": "7.6.0" }
}
```

```
packages/db/
├── prisma/
│   ├── schema.prisma        # single source of truth for all models
│   ├── migrations/          # manual SQL + `prisma migrate deploy`
│   └── seed-*.ts / seeds/   # seed scripts
├── src/
│   ├── index.ts             # explicit re-export of client + enums + model types
│   └── services/            # cross-app DB services (server-only)
└── prisma.config.ts
```

**Dependency direction (enforce this):**
```
apps  ─▶  @repo/domain ─▶ @repo/db ─▶ Prisma/Postgres
  └─────▶ @repo/ui, @repo/shared, @repo/shared-utils, @repo/realtime, @repo/offline
@repo/db is SERVER-ONLY. Client files import TYPES only (`import type`).
Never import @repo/domain inside @repo/db (no cycle).
```

---

## 6. House-renting domain model (starting point for `schema.prisma`)

```
Organization ─┬─ Property ─┬─ Unit ─┬─ Listing (published, searchable)
              │            │        └─ Lease ─┬─ Tenancy (User↔Unit, term, rent)
              │            │                  ├─ RentInvoice ─ Payment
              │            │                  └─ Deposit / DepositRefund
              │            └─ Inspection / Document (photos, contracts)
              ├─ Application ─ Screening (credit/background) ─ Decision
              ├─ MaintenanceRequest ─ WorkOrder ─ Vendor (assignment, status)
              └─ User ─ Role (landlord|agent|tenant|vendor|admin) ─ Permission

Platform-global (not org-scoped): User, Vendor marketplace, Listing search index.
```

Multi-tenant scoping key: **`organizationId`** (or `landlordId`) — the analogue
of this repo's `storeId`. Cross-org search/marketplace models are the explicit
exceptions (like `Customer` here).

---

## 7. Conventions worth copying verbatim

1. **Route → service → Prisma.** API route handlers are thin (parse + auth +
   call service + shape response). All business logic + Prisma live in `services/`.
   No Prisma imports in route handlers.
2. **Multi-tenant discipline.** Every query filters by `organizationId`, taken
   **only from the session**, never from the request body/params. After every
   `findUnique`, assert ownership. Global models are explicit exceptions.
3. **Auth.** NextAuth JWT; per-app cookie name (`landlord.session-token`, …).
   Decode with `next-auth/jwt` in middleware; never `getServerSession` in routes.
   State-changing routes gate through an "active user" context that rejects
   suspended/ended accounts.
4. **Consistent API envelope.**
   `{ success: true, data }` / `{ success: false, error: { code, message } }`,
   with a shared `apiSuccess` / `apiError` + `handleRouteError` mapper.
5. **Zod `.safeParse()`** at every boundary. **No `any`.** `tsc --noEmit` must
   pass for all apps before merge.
6. **Feature flags** in a `FeatureFlag` table (`global_on|global_off|allowlist`)
   read by a shared `isFlagEnabled(db, key, orgId?)` in `@repo/shared-utils`;
   flags fail **closed** when the row is missing.
7. **Migrations:** hand-written SQL + `prisma migrate deploy` (via `DIRECT_URL`).
   Avoid `migrate dev` / `db push` against shared DBs (checksum drift → 500s).
8. **One-off DB scripts live in root `scripts/db/`, NOT `packages/db/scripts/`.**
   `packages/db` is a dependency of every app, so Turbo/Vercel affected-detection
   marks *all* apps changed when any file under it changes — putting scripts at
   the repo root keeps them out of every app's rebuild set.
9. **Server-only DB.** `@repo/db` is server-only; client bundles `import type`
   only. List `"pg"` in each app's `serverExternalPackages`. Keep the pooled
   Prisma client a singleton (small `max`, e.g. 3).
10. **Per-app `CLAUDE.md`** documenting session shape, data rules, route map —
    invaluable as the app grows.

---

## 8. Bootstrap steps

```bash
mkdir house-renting && cd house-renting
git init
# root package.json (workspaces + turbo), turbo.json, tsconfig.json  (copy §3)
npm install -D turbo typescript

# scaffold packages/db first (schema.prisma + src/index.ts + client)
# then packages/ui, packages/shared, packages/shared-utils, ...

# scaffold each app with create-next-app, then:
#   - add "@repo/*": "*" deps
#   - add middleware.ts (auth), lib/ (session context), services/, app/api
#   - set unique dev port per app (3000..3005)

npm run db:generate
npm run dev:landlord
```

Start with **`packages/db` + one app (landlord)** end-to-end (auth → a `Property`
CRUD through route→service→Prisma), then clone that vertical slice per app.

---

*Generated as a structural reference. Swap the domain models/apps for your exact
product; keep the tooling, package boundaries, and the §7 conventions.*
