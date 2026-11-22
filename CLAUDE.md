# CLAUDE.md (Root) — House-Renting Platform

> Target path: repo-root `CLAUDE.md`. Always loaded — keep it short and
> high-signal. Deeper detail lives in `claude-context/`, loaded on demand via
> the `@` references below.

## Stack

Monorepo (Turborepo + npm workspaces): 6 Next.js 16 apps — landlord :6100,
tenant :6101, agent :6102, listings :6103, admin :6104, vendor :6105. Prisma 7 +
Postgres (Supabase-hosted), NextAuth 4 (JWT), Base UI + Tailwind 4, Zod 4,
TanStack Query/Table, Serwist PWA (tenant + vendor).

## Foot-guns

- **Multi-tenant**: every org-owned query filters `where: { organizationId }`.
  `organizationId` comes from the **session only** — never from body/params/query.
  Assert ownership after every `findUnique`. Global exceptions (never
  org-filtered): `User`, the `Vendor` marketplace, the `Listing` search index,
  `UtilityRateBound`, `PaymentMethodCatalog`, and `Notification` (per-user:
  scope by `session.userId`, assert `row.userId` after `findUnique`).
  `OrgUtilityRate` / `OrgPaymentSettings` ARE org-scoped. `Announcement` is
  mixed: `organizationId = null` = system (admin queries filter `null`), set =
  that org's. Tenant sessions carry no org (`{ userId, name }`): derive
  `organizationId`/`unitId` from a lease the user has a `Tenancy` on, never
  from the body; for reads, use the set of orgs across all their tenancies.
- **Money is integer cents everywhere.** Never floats. Format at the edges only.
- **Schema**: never invent fields; never modify `schema.prisma` without instruction.
- **Migrations**: hand-written SQL + `prisma migrate deploy` via `DIRECT_URL`
  (non-pooled). Never `migrate dev` / `db push` on the shared DB.
- **`@repo/db` is server-only.** Client files `import type` only.
  `@repo/shared` is imported by client code: no React/Next/Prisma runtime imports.
- **Auth**: `decode` from `next-auth/jwt` in middleware + `lib/session.ts`; never
  `getServerSession`. Per-app cookie names (`landlord.session-token`, …).
- **Connection pool**: singleton `pg.Pool` in `@repo/db` (`max: 3`). List `"pg"`
  in each app's `next.config` `serverExternalPackages`.

## Code quality

- No `any`. Zod `.safeParse()` / `.parse()` at every boundary.
- **Route → service → Prisma.** Route handlers are thin (session + validate +
  call service + shape response). No business logic in components. No Prisma in
  route handlers.
- **Status changes** (lease, invoice, maintenance) go only through the
  service's `*_TRANSITIONS` table (409 on a disallowed move). UI option lists
  mirror the tables; they are not the guard.
- `tsc --noEmit` must pass for all apps before merge.
- Never hardcode rent/fees/late-fee/currency — read org config.

## API response shape

```ts
{ success: true,  data: T }
{ success: false, error: { code: string, message: string } }
```

Status codes: 200, 201, 400, 401, 403, 404, 409, 500. Use `apiSuccess` /
`apiError` + `handleRouteError` from `apps/<app>/lib/api.ts`.

## Reference docs (load on demand via @)

- **Schema**: `packages/db/prisma/schema.prisma` (full source of truth)
- **Domain**:
  - `@claude-context/domain/rent-billing.md` — invoice totals, utility bounds, payments
  - `@claude-context/domain/notifications.md` — tx, recipients, deepLink
  - `@claude-context/domain/leasing.md` — inspection window, property → lease fees
  - `@claude-context/domain/documents.md` — org + type assert on `Document`
- **Gotchas**: `@claude-context/gotchas.md`

## Apps

The **admin** app is the only app that is NOT org-scoped (global, cross-org);
everything else scopes by `organizationId`.

## Session state

If `SESSION_NOTES.md` exists at repo root, read it first, then delete/rewrite
when your task changes.
