# CLAUDE.md — repo root

Rules of engagement for Claude Code working on this monorepo. Read this before
touching anything. The product/business plan lives in `BUILD_PLAN.md`; this file
covers _how to work_, not _what to build_.

---

## 1. Always start here

- **Read `BUILD_PLAN.md`.** It tells you the current phase, the stack, and the
  acceptance criteria for what you're working on. Never deviate from the locked
  stack in §2 without updating that file first.
- **Read the closest `CLAUDE.md`** to the code you're changing (per-package and
  per-app `CLAUDE.md` files exist; they override this one when they conflict).
- **Read the spec.** Every non-trivial change starts with a spec in
  `docs/specs/<feature>.md` based on `docs/specs/_template.md`. No spec → write
  one before coding.

## 2. Stack — do not swap

pnpm + Turborepo · TypeScript strict · Next.js 15 (App Router) × 4 apps · Tailwind
· shadcn/ui · Serwist PWA · NestJS (Fastify) · Prisma + Postgres 16 · Redis 7 +
BullMQ · Zod · Better-Auth · S3-compatible storage · Resend · Stripe / VNPay
plugins · Sentry + Pino + PostHog · Vitest + Playwright · GitHub Actions.

If you think a swap is justified, propose it in a PR that edits `BUILD_PLAN.md`
first.

## 3. Repo layout

```
apps/{admin,owner,tenant,partner,api,e2e}
packages/{db,shared,ui,config}
docs/{specs,adr}
```

- `apps/api` is the only server. The four frontends call it.
- `packages/shared` is the single source of truth for Zod schemas, enums, and
  error codes shared between client and server.
- `packages/db` owns the Prisma schema. No other package writes migrations.

## 4. Hard rules

- **TypeScript strict.** No `any`. Prefer `unknown` + narrowing.
- **No default exports** except Next.js page/layout/route files.
- **All API I/O via Zod schemas in `@repo/shared`.** Don't redefine shapes per
  endpoint.
- **Money:** integer minor units + `currency`. Never floats.
- **Migrations:** forward-only. Never edit a shipped migration; create a new one.
- **Imports order:** external → `@repo/*` → relative. ESLint enforces.
- **Don't bypass Zod** at module boundaries (HTTP, queue, webhook payloads).
- **Don't invent Prisma fields.** Read `packages/db/prisma/schema.prisma` first.
- **Auth, payments, RBAC, KYC:** human review required on every PR — flag in
  the PR description.

## 5. Working rhythm

For each feature, in order:

1. **Spec** in `docs/specs/<feature>.md`.
2. **Schema + types** — update `packages/db` and `packages/shared`; migrate.
3. **API** — add a NestJS module mirroring the `houses` reference module
   (see `apps/api/CLAUDE.md` once it exists).
4. **Client** — screens reusing `@repo/ui`; forms via `react-hook-form` +
   `@hookform/resolvers/zod` against the shared schema.
5. **E2E** — at least one Playwright happy-path test in `apps/e2e`.
6. **PR** — reference the spec, keep ≤ 500 LoC of generated code, split if larger.

## 6. Definition of done

A task is done only when all of:

- `pnpm turbo typecheck` clean
- `pnpm turbo lint` clean
- Unit tests added & passing
- API endpoint covered by an e2e
- UI screens render correctly at 375px
- Migrations apply on a fresh DB
- Relevant `CLAUDE.md` and the feature spec updated
- No stray `TODO`/`FIXME` without a linked issue

## 7. Local dev

```bash
pnpm install
docker compose up -d        # Postgres, Redis, MinIO, MailHog
pnpm turbo dev              # runs all apps + api in parallel
```

Useful local URLs:

| Service       | URL                        |
| ------------- | -------------------------- |
| Admin         | http://localhost:3000      |
| Owner         | http://localhost:3010      |
| Tenant        | http://localhost:3020      |
| Partner       | http://localhost:3030      |
| API           | http://localhost:3001      |
| API Swagger   | http://localhost:3001/docs |
| MinIO console | http://localhost:9001      |
| MailHog       | http://localhost:8025      |

## 8. Commits & branches

- Branch: `phase-<n>/<feature-slug>`.
- Conventional commits enforced by commitlint (see `commitlint.config.cjs` for
  allowed scopes — adding a new workspace package usually requires adding a
  scope in the same commit).
- One feature = one PR. Reference the spec.
