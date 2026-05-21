# Spec: Rate limit + CSP + security headers + audit (phase 6.3)

> Status: **implemented**
> Phase: 6
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

6.1 and 6.2 cover regression detection (e2e). 6.3 closes the other
half of "production-ready" — making the platform resilient to abuse
and observable when a CVE lands. Three concrete additions:

- **Rate limits** on the API to slow brute-force OTP guessing and
  cap application spam.
- **Security headers** on the four Next.js PWAs. Today they ship
  with Next defaults — no HSTS, no CSP, no X-Frame-Options. Headers
  are the cheapest defense-in-depth we can add.
- **Dependency audit triage** — `pnpm audit --prod` currently
  reports 25 advisories (1 critical, 10 high). This slice
  catalogues them, marks which are accepted, and adds a CI step so
  new findings surface on every push.

The API already has `@fastify/helmet` registered with sensible
defaults (HSTS, X-Frame, etc.), so we don't repeat that work — we
just add what's missing.

## 2. User stories

- As an **operator**, I want a brute-force OTP attempt to start
  hitting 429s after a handful of tries from one IP.
- As a **security reviewer**, I want every browser response from
  the PWAs to carry HSTS, X-Frame-Options DENY, and a tight CSP.
- As a **developer**, I want a single `docs/security-advisories.md`
  that says "these are the known findings and why we haven't
  upgraded yet" so CI noise doesn't become normal.
- As **CI**, I want a non-blocking audit job that uploads the JSON
  report on every run so we notice the day a new critical lands.

## 3. Surfaces

| Surface             | File                                               | Notes                                    |
| ------------------- | -------------------------------------------------- | ---------------------------------------- |
| Rate limit          | `apps/api/src/main.ts`                             | `@fastify/rate-limit` global + overrides |
| Security headers    | `packages/config/security/headers.ts`              | `securityHeaders()` preset               |
| Next config wire-up | `apps/{admin,owner,tenant,partner}/next.config.ts` | Calls the preset                         |
| Advisories doc      | `docs/security-advisories.md`                      | Triage list + acceptance status          |
| CI audit job        | `.github/workflows/ci.yml`                         | New `audit` job, non-blocking            |

## 4. API rate limit

Use `@fastify/rate-limit` (in-memory store — single instance is
fine for v1; Redis-backed store comes when we deploy multiple
replicas). Defaults:

| Scope                                      | Window | Max | Notes                                                  |
| ------------------------------------------ | ------ | --- | ------------------------------------------------------ |
| **global**                                 | 1 min  | 600 | All routes; per-IP. Headers + 429 on bust.             |
| `/v1/auth/email-otp/send-verification-otp` | 1 min  | 5   | Anti-enumeration + anti-brute                          |
| `/v1/auth/sign-in/email-otp`               | 1 min  | 10  | OTP verify — guard against guessing                    |
| `/v1/me/applications` (POST)               | 1 hr   | 20  | Mirrors existing `applications.rate_limited` semantics |
| `/v1/me/tickets` (POST)                    | 1 min  | 10  | Anti-spam                                              |

`@fastify/rate-limit` returns RFC 6585 429 with
`Retry-After`. We map it through our ProblemError filter so the
body stays `application/problem+json` with code
`common.rate_limited` (already in `ErrorCodes`).

IP detection respects `trustProxy: true` (already set) so the
limiter sees the client IP behind a load balancer.

### Disabling for tests

`API_DISABLE_RATE_LIMIT=true` env flag bypasses the plugin entirely.
The e2e suite sets it (a real hammer flow would otherwise hit 429
mid-test).

## 5. Next.js security headers

A new preset in `@repo/config`:

```ts
// packages/config/security/headers.ts
export function securityHeaders(opts: {
  apiOrigin: string;
  /** Extra connect-src origins (PostHog, Sentry, etc.). */
  extraConnectSrc?: string[];
  /** Loosen CSP in dev for HMR + React DevTools. */
  isDev: boolean;
}): { source: string; headers: { key: string; value: string }[] }[];
```

Header set (every app):

| Header                      | Value                                          |
| --------------------------- | ---------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options`    | `nosniff`                                      |
| `X-Frame-Options`           | `DENY`                                         |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`              |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`     |
| `Content-Security-Policy`   | see below                                      |

CSP:

```
default-src 'self';
script-src 'self' 'unsafe-inline'{dev: + 'unsafe-eval'};
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self' {API_ORIGIN} {extraConnectSrc};
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests
```

`'unsafe-inline'` for scripts is forced by Next.js's inline
hydration bootstrap. Nonces (the proper fix) need a custom
middleware that streams a nonce into the HTML — a known-good
follow-up but out of scope here. `'unsafe-eval'` for dev only
(React DevTools, error overlay).

`img-src` is permissive on purpose: campaign / proof photos may
come from S3, Vercel Blob, or a free image host while we're
pre-production. Tighten when we lock the storage layer.

Each app's `next.config.ts` wraps `withSerwist(...)` with the
preset:

```ts
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const isDev = process.env.NODE_ENV !== 'production';
config.headers = async () => securityHeaders({ apiOrigin, isDev });
```

## 6. Audit triage

`docs/security-advisories.md` lists the 25 current findings with:

- ID + severity + advisory link.
- Affected path (transitive vs direct).
- Disposition: `accepted` (no easy fix, dual to lower priority
  scope) / `tracked` (scheduled fix) / `fixed`.

The big-ticket items:

| #   | Severity | Package                    | Disposition | Notes                                                                                                         |
| --- | -------- | -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | critical | `@fastify/middie`          | tracked     | Pulled in by `@nestjs/platform-fastify` 10.x; needs Nest 11 upgrade. Major bump — scheduled for post-Phase 6. |
| 2   | high     | `fastify`                  | tracked     | Same — Nest 11 + fastify 5 upgrade.                                                                           |
| 3   | high     | `glob` (transitive)        | accepted    | CLI-only; we don't invoke `glob` shell mode.                                                                  |
| 4   | high     | `@nestjs/platform-fastify` | tracked     | See #1.                                                                                                       |
| …   | various  | many                       | accepted    | Mostly dev-only (`webpack`, `tsx`, `nodemon`); enumerated in the doc.                                         |

The CI `audit` job runs `pnpm audit --prod --json` and uploads
the report as an artifact. It does **not** fail the build — the
acceptance status lives in the doc, not in a CI gate. When we
fix #1-#4 we can flip the job to fail on new critical findings.

## 7. Edge cases

- **Rate-limit collision in dev** — devs hammering the API while
  debugging hit limits quickly. `API_DISABLE_RATE_LIMIT=true` in
  `apps/api/.env.example` documents the escape hatch.
- **Headers ordering** — Next merges `headers()` results into the
  static asset path matchers too; that's fine, static assets carry
  the same headers, which is desirable.
- **CSP and Swagger** — the API serves Swagger at `/docs` in
  non-production. Helmet's CSP is disabled in dev for exactly
  this reason. Production CSP is helmet's default (strict).
- **Serwist service worker** — `connect-src 'self'` covers SW
  fetches; no separate directive needed.

## 8. Out of scope

- **Real audit-fail CI gate** — happens after the Nest 11 upgrade
  closes the critical.
- **CSP nonces** — proper fix for `'unsafe-inline'`, needs
  middleware. Follow-up slice.
- **WAF / Cloud rate limit** — infra-level; we ship app-level
  here.
- **2FA enforcement** — distinct slice.
- **Secret scanning in CI** — Phase 6.6 with the runbook + rotation
  policy.

## 9. Acceptance criteria

- [x] `@fastify/rate-limit` registered with global default + four
      per-route overrides; 429 surfaces as `application/problem+json`
      with `common.rate_limited`.
- [x] `API_DISABLE_RATE_LIMIT=true` short-circuits the plugin.
- [x] `packages/config/security/headers.ts` exports a tested
      `securityHeaders()` builder.
- [x] All four Next.js apps return HSTS + X-Frame + CSP +
      Referrer-Policy + Permissions-Policy on every page load.
- [x] `docs/security-advisories.md` enumerates the 25 current
      advisories with disposition.
- [x] CI `audit` job runs `pnpm audit --prod` and uploads the
      JSON report.
- [x] `pnpm turbo typecheck lint` clean.

## 10. Manual test plan

1. `pnpm dev`, hit `/v1/auth/email-otp/send-verification-otp` 6
   times — assert sixth returns 429 with
   `application/problem+json`.
2. `curl -I http://localhost:3010` (owner) — assert HSTS, X-Frame,
   CSP, etc. in the response.
3. Open browser devtools → network tab → confirm CSP doesn't
   break the app (no console violations after a normal flow).
4. `pnpm audit --prod` matches what's in
   `docs/security-advisories.md`.

## 11. Rollout

- No migrations.
- Set `API_DISABLE_RATE_LIMIT=true` in any short-lived local
  hammering script.
- Comms: dev changelog — "rate limits live; PWAs ship with
  HSTS/CSP/X-Frame; security advisories tracked in `docs/`."
