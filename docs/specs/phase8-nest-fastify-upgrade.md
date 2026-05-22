# Spec: NestJS 11 + Fastify 5 upgrade (phase 8.5)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

`docs/security-advisories.md` has nine `tracked` items — one critical
plus eight high — all rooted in Fastify 4 and `@nestjs/platform-fastify`
10.x. Per that doc:

> The bulk of `tracked` items (1, 3-5, 7-11) all clear with a single
> upgrade: `@nestjs/core` 10.x → 11.x, `@nestjs/platform-fastify` 10.x →
> 11.x, `fastify` 4.x → 5.7.x.

Phase 7 + 8.1-8.4 are done; this is the right slice to take the
breaking-change pain because the CI gates (lint, typecheck, unit tests,
e2e) catch most regressions before they ship. Once it lands we can
flip the CI `audit` job to fail-on-critical and stop carrying advisory
debt forward.

## 2. User stories

- As **security**, after this slice `pnpm audit --prod --audit-level=critical`
  exits 0 and the CI audit job rejects PRs that re-introduce critical
  advisories.
- As an **API consumer**, the public surface is unchanged: same
  endpoints, same Problem responses, same auth cookies.
- As a **developer**, the dev server, Swagger UI, and the e2e suite
  boot exactly the same way.

## 3. Surfaces

| Surface                                         | Notes                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/package.json`                         | NestJS 10 → 11, Fastify 4 → 5, every `@fastify/*` plugin bumped.                                                                                                      |
| `apps/api/src/main.ts`                          | Plugin registration + rate-limit hooks. Fastify 5 keeps the same `app.register(...)` shape; the `onRequest` and `onSend` hooks survive but plugin option types shift. |
| `apps/api/src/auth/auth.controller.ts`          | Uses `req.url`/`req.method`/`req.protocol`/`req.headers.host`. All four still exist on Fastify 5 — kept as-is.                                                        |
| `apps/api/src/common/filters/problem.filter.ts` | Reads `req.url`. Unchanged.                                                                                                                                           |
| Tests                                           | None of the unit specs construct a Fastify request directly; they hit services. No breakage expected.                                                                 |

## 4. Dependency bumps

```
@nestjs/common              ^10.4.5  → ^11.x
@nestjs/core                ^10.4.5  → ^11.x
@nestjs/platform-fastify    ^10.4.5  → ^11.x
@nestjs/swagger             ^8.0.1   → ^11.x  (8.x is for Nest 10)
@nestjs/bullmq              ^10.2.1  → ^11.x
@nestjs/cli                 ^10.4.5  → ^11.x
@nestjs/schematics          ^10.2.3  → ^11.x
@nestjs/testing             ^10.4.5  → ^11.x

fastify                     ^4.28.1  → ^5.7.x
@fastify/cookie             ^9.4.0   → ^11.x
@fastify/cors               ^9.0.1   → ^10.x
@fastify/helmet             ^11.1.1  → ^13.x
@fastify/static             ^7.0.4   → ^8.x
@fastify/rate-limit         ^10.3.0  → kept (already Fastify-5 compatible — 10.x
                                            was the cause of the e2e "expected '5.x'
                                            fastify version" error on `main`).
```

Other workspaces (admin/owner/tenant/partner/e2e) only consume
`@repo/shared` and HTTP; they don't depend on Nest or Fastify and
require no changes here.

## 5. Breaking-change surface — items we expect to hit

Per Fastify 5 migration notes + Nest 11 changelog:

- **`req.routerPath` → `req.routeOptions.url`** — not used anywhere
  in our code (grep clean), but worth verifying after the bump.
- **`reply.getResponseTime()`** removed — we don't use it.
- **Stricter route option validation** — `addContentTypeParser`
  signature unchanged but options validation is tighter. Our custom
  JSON parser in `main.ts` should keep working; ready to adjust the
  `parseAs` shape if not.
- **`request.context` shape change** — we don't read `req.context`.
- **`@fastify/helmet` 13** — drops `contentSecurityPolicy: false`
  shorthand? Verify the default still allows disabling in dev.
- **`@fastify/cors` 10** — keep-alive defaults shifted; `credentials:
true` still accepted.
- **`@nestjs/swagger` 11** — DocumentBuilder API stable; SwaggerModule
  setup unchanged.

If something else trips during the upgrade, fix in place + note in
this spec.

## 6. Migration safety

- **Forward-only, no schema or migration change**. Pure dependency
  bump.
- **CI catches regressions**: typecheck across the monorepo, lint,
  unit tests (296 specs), and e2e (Playwright) all run on the PR.
- **Smoke-boot the API locally** after the bump to verify Swagger
  loads, `/v1/healthz` responds, and at least one authenticated
  route returns 200.

## 7. Out of scope

- Any new functionality.
- Other dependency upgrades (Prisma 5 → 6, Next 15.x → 16, etc.).
- Switching off Fastify for Express, or any rendering / route
  refactor.

## 8. Acceptance criteria

- [ ] `apps/api/package.json` declares NestJS 11 + Fastify 5 versions
      per §4.
- [ ] `pnpm install` reports no unmet peer dependency on Fastify /
      NestJS.
- [ ] `pnpm turbo typecheck` clean.
- [ ] `pnpm turbo lint` clean.
- [ ] `pnpm --filter @repo/api test` clean (296+ tests).
- [ ] `pnpm audit --prod --audit-level=critical` exits 0.
- [ ] `docs/security-advisories.md` items 1, 3-5, 7-11 moved to
      `fixed`.
- [ ] `.github/workflows/ci.yml` `audit` job flipped to fail on
      critical.

## 9. Manual test plan

1. `pnpm install` clean.
2. `pnpm --filter @repo/api dev` — wait for the listen log.
3. `curl http://localhost:3001/healthz` → 200 with the health JSON.
4. `curl http://localhost:3001/v1/me` without cookie → 401 problem+json.
5. Open `http://localhost:3001/docs` → Swagger UI renders, every tag
   still listed.

## 10. Rollout

- No feature flag (pure dep bump).
- No DB migration.
- Re-deploy in the usual lane; if the API crashes on boot, redeploy
  the prior tag — the bump is the entirety of the slice.
