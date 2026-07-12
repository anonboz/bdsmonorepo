# CLAUDE.md — repo root

> **This repo was re-architected.** The active project is the house-renting
> platform under [`house-renting/`](./house-renting/) — a Turborepo + **npm**
> workspaces monorepo of **6 Next.js 16 apps** (landlord, tenant, agent,
> listings, admin, vendor) over Prisma 7 + Postgres, NextAuth 4 (JWT), and
> Tailwind 4. Each Next app owns its own route handlers + fat `services/`
> (no central API server).

## Start here

- **Work inside `house-renting/`.** Read [`house-renting/CLAUDE.md`](./house-renting/CLAUDE.md)
  for the guardrails (multi-tenant scoping, route→service→Prisma, per-app auth,
  money-in-cents, `@repo/db` is server-only).
- Read the per-app `house-renting/apps/<app>/CLAUDE.md` for the app you're in.
- `house-renting-starter/` is the read-only reference template the rewrite was
  based on. `docs/` and `BUILD_PLAN.md` describe the previous product.

## History

The previous stack (NestJS API + pnpm + Better-Auth + 4 PWAs) was replaced on
branch `rewrite/house-renting-arch`. It still exists on `main` and in git
history if you need to reference it.
