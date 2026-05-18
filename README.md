# bdsmonorepo

Multi-app rental platform — Admin, Owner, Tenant, Partner PWAs over a single
NestJS API.

For the product plan, phases, and acceptance criteria, see
[`BUILD_PLAN.md`](./BUILD_PLAN.md). For the rules Claude Code follows when
working in this repo, see [`CLAUDE.md`](./CLAUDE.md).

## Quick start

Requirements: Node 20.x, pnpm 9.x, Docker.

```bash
pnpm install
docker compose up -d         # Postgres 16, Redis 7, MinIO, MailHog
pnpm turbo build             # full build, verifies the toolchain
pnpm turbo dev               # all apps + api in parallel
```

## Layout

```
apps/
  admin/    Next.js — system config, KYC, moderation, dashboards (desktop-first)
  owner/    Next.js — houses, leases, bills, campaigns (mobile-first PWA)
  tenant/   Next.js — bills, payments, tickets, ratings (mobile-first PWA)
  partner/  Next.js — broker/repair/service marketplace (mobile-first PWA)
  api/      NestJS — Fastify, Prisma, BullMQ workers
  e2e/      Playwright cross-app suites

packages/
  config/   tsconfig, eslint, prettier, tailwind, env loader
  db/       Prisma schema + migrations + seed (single source of truth)
  shared/   Zod schemas, enums, error codes — shared client↔server
  ui/       shadcn/ui-based components shared across the four frontends

docs/
  specs/    one .md per feature (write before coding — see _template.md)
  adr/      architecture decision records
```

## Local URLs

| Service       | URL                          |
| ------------- | ---------------------------- |
| Admin         | http://localhost:3000        |
| Owner         | http://localhost:3010        |
| Tenant        | http://localhost:3020        |
| Partner       | http://localhost:3030        |
| API           | http://localhost:3001        |
| API Swagger   | http://localhost:3001/docs   |
| MinIO console | http://localhost:9001        |
| MailHog       | http://localhost:8025        |

## Workflow

Conventional commits enforced by commitlint. Husky runs lint-staged on
pre-commit. Each feature follows the rhythm in `BUILD_PLAN.md §6`: spec →
schema + types → API → client → e2e → PR.
