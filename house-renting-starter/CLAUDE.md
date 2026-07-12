# CLAUDE.md (Root) — House-Renting Platform

> Target path: repo-root `CLAUDE.md`. Always loaded — keep it short and
> high-signal. Deeper detail lives in `claude-context/` and per-app files, loaded
> on demand via the `@` references below.

## Stack

Monorepo (Turborepo + npm workspaces): 6 Next.js 16 apps — landlord :3000,
tenant :3001, agent :3002, listings :3003, admin :3004, vendor :3005. Prisma 7 +
Postgres (Supabase-hosted), NextAuth 4 (JWT), Base UI + Tailwind 4, Zod 4,
TanStack Query/Table, Serwist PWA (tenant + vendor).

## Foot-guns

- **Multi-tenant**: every org-owned query filters `where: { organizationId }`.
  `organizationId` comes from the **session only** — never from body/params/query.
  Assert ownership after every `findUnique`. Global exceptions: `User`, the
  `Vendor` marketplace, and the `Listing` search index.
- **Money is integer cents everywhere.** Never floats. Format at the edges only.
- **Schema**: never invent fields; never modify `schema.prisma` without instruction.
- **Migrations**: hand-written SQL + `prisma migrate deploy` via `DIRECT_URL`
  (non-pooled). Never `migrate dev` / `db push` on the shared DB. See
  `@claude-context/prisma-patterns.md`.
- **`@repo/db` is server-only.** Client files `import type` only. Never import
  `@repo/domain` inside `@repo/db` (direction is `domain → db`, no cycle).
- **Auth**: `decode` from `next-auth/jwt` in middleware + `lib/session.ts`; never
  `getServerSession`. Per-app cookie names (`landlord.session-token`, …).
- **Connection pool**: singleton `pg.Pool` in `@repo/db` (`max: 3`). List `"pg"`
  in each app's `next.config` `serverExternalPackages`.

## Code quality

- No `any`. Zod `.safeParse()` / `.parse()` at every boundary.
- **Route → service → Prisma.** Route handlers are thin (session + validate +
  call service + shape response). No business logic in components. No Prisma in
  route handlers.
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
- **Patterns**: `@claude-context/auth-rules.md`, `@claude-context/api-patterns.md`,
  `@claude-context/prisma-patterns.md`, `@claude-context/ui-rules.md`
- **Architecture**: `@claude-context/architecture.md`,
  `@claude-context/package-architecture.md`, `@claude-context/pwa.md`,
  `@claude-context/realtime.md`
- **Domain**: `@claude-context/domain/INDEX.md` — read it to pick the right file,
  then `@`-load that one (leasing / rent-billing / applications-screening /
  maintenance / deposits / feature-flags / documents).
- **Gotchas**: `@claude-context/gotchas.md`

## Per-app CLAUDE.md

Each app has `apps/<app>/CLAUDE.md` — read the one for the app you're in.
The **admin** app is the only app that is NOT org-scoped (global, cross-org);
everything else scopes by `organizationId`.

## Session state

If `SESSION_NOTES.md` exists at repo root, read it first, then delete/rewrite
when your task changes.
