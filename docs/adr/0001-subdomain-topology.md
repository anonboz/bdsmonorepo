# ADR-0001: Subdomain-per-role deployment topology

- **Status:** accepted
- **Date:** 2026-05-24
- **Decider(s):** claude (drafted), user (approved)
- **Context tags:** infra, auth, deploy

## Context

The platform ships four PWAs over a single NestJS API: `admin`, `owner`,
`tenant`, `partner`. In local dev each runs on its own port
(3000/3010/3020/3030/3001). Production deployment was an open item in
BUILD_PLAN §8 — single domain with role-prefixed routes vs.
subdomain-per-role — and Phase 12.2 closes it.

Constraints that pushed the call:

- **Auth cookies cross apps.** Better-auth was already configured
  (Phase 1.2) with `crossSubDomainCookies: { enabled: prod, domain:
AUTH_COOKIE_DOMAIN }`. That config only makes sense if the apps
  share a parent domain — single-domain or single-app deployments
  don't need it.
- **Independent deploy cadences.** Tenant + owner ship the most user-
  facing changes; admin is internal; partner is low-traffic. We want
  to deploy each on its own cadence without a coupled rollback
  blast radius.
- **Independent caching / CDN behavior.** Static assets for the
  tenant app are much hotter than admin's; cache TTLs, headers, and
  routing rules differ per audience. Per-subdomain deploys to
  separate Vercel projects are the path of least friction here.
- **Per-app analytics + observability.** PostHog projects, Sentry
  projects, and PWA install prompts are naturally scoped to one
  audience. Mixing them under one domain forces inline branching
  on every initialiser.
- **Security separation.** Admin is the most sensitive surface;
  isolating it to its own subdomain means CSP, helmet headers, and
  cookie scope can be tighter without affecting the consumer-facing
  apps.

## Decision

**Production runs each PWA on its own subdomain of the platform
domain.** API runs on its own subdomain too. Canonical shape
(placeholder until the real domain is registered):

| App     | Subdomain                |
| ------- | ------------------------ |
| Admin   | `admin.bdsmonorepo.vn`   |
| Owner   | `owner.bdsmonorepo.vn`   |
| Tenant  | `tenant.bdsmonorepo.vn`  |
| Partner | `partner.bdsmonorepo.vn` |
| API     | `api.bdsmonorepo.vn`     |

Auth cookies are scoped to `.bdsmonorepo.vn` (leading dot) so a
single session works across all four apps. CORS allow-list on the
API includes exactly those four PWA origins (plus
`https://bdsmonorepo.vn` if a marketing root ever lands). Each PWA
is deployed to its own Vercel project; the API ships on
Railway/Fly (per `BUILD_PLAN` §2).

The DNS / hosting glue is environment configuration only — no source
changes. The relevant env vars already exist or are added in 12.2:

- API: `API_PUBLIC_URL`, `API_CORS_ORIGINS` (CSV),
  `AUTH_COOKIE_DOMAIN`, `TENANT_APP_URL`, `OWNER_APP_URL` (added
  12.2), `PARTNER_APP_URL`, `ADMIN_APP_URL` (added 12.2).
- Each PWA: `NEXT_PUBLIC_API_URL` (already shipped).

## Options considered

### A. Subdomain-per-role (chosen)

- **Pros:**
  - Cleanest cookie scope; better-auth's `crossSubDomainCookies` is
    designed for this exact shape (already wired).
  - Independent deploy cadences and rollback windows per audience.
  - Per-audience CSP / observability / cache rules without inline
    branches.
  - Separate Vercel projects mean separate build envs, separate
    preview URLs per PR per app, separate analytics envelopes.
  - Trivial to add more roles later (e.g. `agent.bdsmonorepo.vn`)
    without touching the existing apps.
- **Cons:**
  - DNS + TLS cert provisioning is per-subdomain (Vercel
    auto-handles cert issuance, but ops still maintains DNS
    records). Wildcards mitigate.
  - Cross-app links use absolute URLs (`https://owner.bdsmonorepo.vn/houses`),
    not relative paths. Tested in the existing Stripe + VNPay return
    flows — already works.
  - Each preview deploy creates a new origin string per PR; the
    API's CORS allow-list needs a regex or `*.vercel.app` wildcard
    for previews to talk to staging API.
- **Cost:** ~1 eng-week for DNS + Vercel project setup + smoke
  tests; ~$0 incremental (Vercel charges per project but flat
  per-domain TLS is included; Railway/Fly stay one service).

### B. Single domain with role-prefixed routes (`app.bdsmonorepo.vn/{admin,owner,...}`)

- **Pros:**
  - One DNS record, one TLS cert, one Vercel project.
  - Relative links inside the platform work without any URL
    composition.
  - Cookie scope is automatic — same host, no `crossSubDomainCookies`
    contortions.
- **Cons:**
  - Couples deploy cadences: a tenant-UI bug fix can't ship without
    rebuilding admin's bundle. Rollback blast radius is all four
    apps.
  - Per-audience config (CSP, CDN, analytics) requires inline
    branching on the URL path inside the platform code.
  - The Next.js App Router can do this via grouped routes
    (`app/(admin)/...` etc.), but four separate Next projects can't
    coexist under one Vercel deploy — would require rewriting all
    four into one app, a non-trivial regression on the per-app
    `CLAUDE.md` boundaries.
  - Admin's stricter security posture has to bleed into the
    consumer apps' header config.
- **Cost:** ~2-3 eng-weeks to merge the four Next projects + reshape
  the per-app config; ongoing tax forever as a coupled deploy.

### C. Single-app monolith (`app.bdsmonorepo.vn`, role-aware in one Next.js project)

- **Pros:**
  - Strongest sharing of code (Hot reloaded one Next project) +
    simplest URL story.
- **Cons:**
  - Throws away the per-app `CLAUDE.md` boundaries that have shaped
    every phase since Phase 1.
  - Single bundle means a tenant-only fix loads admin code on the
    tenant device (or requires aggressive code splitting that
    re-creates the per-app structure anyway).
  - Worst rollback story: every audience shares one deploy.
- **Cost:** ~3-5 eng-weeks of merge work; entire rewrite of the
  per-app routing / middleware / chrome.

## Consequences

**Positive:**

- Per-app deploys land independently; a tenant-CSS fix doesn't
  rebuild admin.
- Auth + cookie scoping is the documented better-auth happy path.
- Preview URLs per PR per app, Vercel-native (`tenant-git-<branch>.vercel.app`).
- Admin gets its own CSP / analytics / observability without
  branching consumer-app code.

**Negative:**

- DNS records to maintain: 5 A/CNAME records (admin, owner, tenant,
  partner, api). Wildcard A record cuts that to 1 if the registrar
  supports it.
- Preview deploys need CORS allow-list flexibility — the simplest
  shape is a CSV `API_CORS_ORIGINS` with explicit entries for the
  prod hosts + a wildcard for preview Vercel URLs. Mitigated by
  using one preview API per staging branch.
- Cross-app navigation requires absolute URLs (works fine; already
  used for Stripe + VNPay return URLs).

**Neutral:**

- The `AUTH_COOKIE_DOMAIN` env var already exists and ships with
  this shape. Setting it to `.bdsmonorepo.vn` (leading dot) is the
  one-line ops change at cutover.

## Follow-ups

- **DNS + Vercel project setup** when the production domain is
  registered. Replace `bdsmonorepo.vn` everywhere with the chosen
  domain (single sed across the codebase — only documentation
  references it; no compiled code does).
- **Preview-environment CORS strategy.** Wildcard `*.vercel.app` or
  a per-branch allow-list. Decide when the first staging deploy
  lands.
- **Marketing root** (`bdsmonorepo.vn` with no subdomain). Decide
  whether the tenant app handles the root by serving a marketing
  page on `/` or whether a separate static site lives there.
  Marked out-of-scope of 12.2 — pick when the marketing copy is
  ready.

## References

- BUILD_PLAN §8 (open decisions) — flagged this item.
- `apps/api/src/auth/better-auth.config.ts:84-91` — existing
  `crossSubDomainCookies` block.
- Better-auth docs on subdomain cookie scoping:
  https://www.better-auth.com/docs/concepts/cookies#cross-subdomain
- Vercel multi-project deployment notes:
  https://vercel.com/docs/multi-tenant
