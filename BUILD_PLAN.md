# BUILD_PLAN.md

> Build plan for the multi-app rental platform. Read this before starting any task. Keep it updated as the project evolves.

---

## 1. Product overview

A platform with four PWAs over a single backend API:

- **Admin** — system config, KYC, moderation, campaigns, analytics.
- **Owner** — manage houses, leases, bills, campaigns, partner services.
- **Tenant** — view bills, pay, send reports, request repairs, feedback.
- **Partner** — broker / repair / service providers; receive and fulfill jobs.

All four are installable PWAs. No native shells in this phase.

---

## 2. Tech stack (locked)

- **Monorepo:** pnpm workspaces + Turborepo
- **Language:** TypeScript strict everywhere
- **Frontend:** Next.js 15 (App Router) × 4 apps, Tailwind, shadcn/ui
- **PWA:** Serwist (or `next-pwa`) per app
- **Backend:** NestJS (Fastify adapter)
- **DB:** PostgreSQL + Prisma
- **Cache / queue:** Redis + BullMQ
- **Validation:** Zod (shared between client and API)
- **Auth:** Better-Auth (phone OTP + email magic link), JWT access + refresh cookie
- **Storage:** S3-compatible (R2 in prod, MinIO locally)
- **Email:** Resend
- **Payments:** Stripe (intl) and/or VNPay/MoMo (VN) — pluggable provider interface
- **Observability:** Sentry, Pino, PostHog
- **Testing:** Vitest (unit), Playwright (e2e)
- **CI/CD:** GitHub Actions; previews on Vercel (frontends) + Railway/Fly (api)

Do not swap any of the above without updating this file.

---

## 3. Repository structure

```
.
├── apps/
│   ├── admin/        # Next.js — web, desktop-first
│   ├── owner/        # Next.js — mobile-first PWA
│   ├── tenant/       # Next.js — mobile-first PWA
│   ├── partner/      # Next.js — mobile-first PWA
│   ├── api/          # NestJS API + workers
│   └── e2e/          # Playwright e2e suites
├── packages/
│   ├── db/           # Prisma schema, client, migrations, seed
│   ├── shared/       # Zod schemas, types, enums, constants
│   ├── ui/           # shadcn/ui components shared across frontends
│   └── config/       # tsconfig, eslint, tailwind, env loader
├── docs/
│   ├── specs/        # one .md per feature before implementation
│   └── adr/          # architecture decision records
├── docker-compose.yml
├── turbo.json
├── pnpm-workspace.yaml
└── CLAUDE.md         # rules for Claude Code (separate from this file)
```

---

## 4. Conventions

**Code**

- Imports: external → internal packages (`@repo/*`) → relative. Enforced by ESLint.
- No default exports except Next.js pages/layouts.
- All API inputs and outputs typed via Zod schemas in `@repo/shared`.
- No `any`. Prefer `unknown` + narrowing.

**Database**

- All tables have `id` (cuid2), `createdAt`, `updatedAt`.
- Soft-delete via `deletedAt` where deletion needs to be reversible; hard-delete otherwise.
- All money in **minor units** (integer), with a `currency` field.
- Migrations are forward-only; never edit a shipped migration.

**API**

- REST under `/v1/*`. Errors follow RFC 7807 (`application/problem+json`).
- One Nest module per domain (`houses`, `bills`, ...). Each has: controller, service, dto (Zod), guard if needed, tests.
- Use the `Houses` module as the canonical template — copy its structure for new modules.

**Frontend**

- Server Components for reads, Client Components for interactivity.
- Data fetching via a typed `apiClient` in `app/lib/api.ts`.
- Forms: `react-hook-form` + `@hookform/resolvers/zod` with the shared schema.
- Route segments mirror navigation: `/houses`, `/houses/[id]`, `/houses/[id]/edit`.

**Git**

- Branch: `phase-<n>/<feature-slug>`.
- Conventional commits.
- One feature = one PR. Target ≤ 500 lines of generated code per PR; split if larger.
- PR description must reference the spec under `docs/specs/`.

---

## 5. Phases

Each phase is a milestone. Tasks inside a phase are PR-sized and dependency-ordered. Do not start a phase until the previous one's acceptance criteria are met.

### Phase 0 — Foundation (Week 0–1)

Goal: empty repo → green CI → local dev environment running.

1. Init pnpm + Turborepo monorepo. Add `turbo.json`, `pnpm-workspace.yaml`, `.nvmrc` (Node 20), `.editorconfig`.
2. `packages/config`: shared `tsconfig.base.json`, ESLint flat config, Prettier, Tailwind preset, env loader (Zod-validated).
3. Husky + lint-staged + commitlint.
4. GitHub Actions CI: install, typecheck, lint, test, build. Cache pnpm + Turbo.
5. `docker-compose.yml`: Postgres 16, Redis 7, MinIO. Healthchecks.
6. Root `CLAUDE.md` + per-package `CLAUDE.md` stubs.

Acceptance: `pnpm install && docker compose up && pnpm turbo build` works on a fresh clone; CI green.

---

### Phase 1 — Domain + auth + reference slice (Week 2–3)

Goal: real data model, working auth across all roles, one end-to-end CRUD path used as the pattern.

1. `packages/db`: Prisma schema v1 with all models stubbed (relations and timestamps only).
   Models: `User`, `Role`, `House`, `Unit`, `Lease`, `Bill`, `Payment`, `Ticket`, `Campaign`, `Application`, `PartnerProfile`, `Service`, `ServiceJob`, `Notification`, `AuditLog`.
   Seed script with 1 admin, 2 owners, 4 tenants, 2 partners.
2. `packages/shared`: enums (`Role`, `BillStatus`, `TicketStatus`, `JobStatus`), base Zod schemas, error codes.
3. `apps/api` scaffold: NestJS + Fastify, global Zod pipe, RFC 7807 filter, Swagger at `/docs`, `/healthz`.
4. `apps/api/src/auth`: Better-Auth integration, OTP + magic link, JWT + refresh cookie, `@Roles()` guard.
5. `apps/api/src/houses`: full CRUD as the reference module — DTOs, service, controller, pagination, ownership guard, unit + e2e tests. **Document this pattern in `apps/api/CLAUDE.md`.**
6. `packages/ui`: shadcn/ui installed, base components exported.
7. Four Next.js apps scaffolded (`admin`, `owner`, `tenant`, `partner`). Login flow + role-gated landing page in each. Typed API client.
8. PWA config per app: manifest, icons, service worker (network-first for API, SWR for assets), offline fallback.

Acceptance:

- Each role can log in via its app and is rejected from the others.
- An owner can create, list, view, edit, and delete a house from the owner app.
- Lighthouse PWA score ≥ 90 on each app.

---

### Phase 2 — Owner + Tenant MVP (Week 4–7)

Goal: a tenant can receive a bill and pay it; an owner can manage units and bills end-to-end.

1. Units under Houses: nested CRUD, photos to object storage, status (`vacant`/`occupied`/`maintenance`).
2. Leases: create lease linking Unit ↔ Tenant, deposit, start/end, rent amount, rent cycle.
3. Bill generation: BullMQ job that creates bills on cycle anchor; manual "generate now" for testing. Bill line items (rent, utilities, fees).
4. Tenant bill views: current bill, history, downloadable receipt PDF (generate server-side).
5. Payment provider abstraction (`PaymentProvider` interface). Implement Stripe first. Webhook handler reconciles `Payment` → `Bill.status`.
6. Notifications module: `notifications.send` queue, email via Resend, in-app inbox table + endpoints, web push where supported.
7. Reminder jobs: T-3, T-0, T+3 from bill due date.
8. Owner dashboard: occupancy, MRR, overdue bills, recent payments.

Acceptance:

- Owner creates lease → bill auto-generates on schedule → tenant pays via Stripe test → both apps reflect new status within 10s of webhook.
- Reminder emails fire at the right offsets in a manual time-shift test.

---

### Phase 3 — Admin + tickets + feedback (Week 8–10)

Goal: tenants can raise issues; owners can manage them; admins can run the system.

1. Tickets module: tenant creates report/repair with category + photos. Status machine: `open` → `acknowledged` → `in_progress` → `resolved` → `closed`. Reopen allowed within 7 days.
2. Ticket chat thread (messages + attachments).
3. Ratings: tenant ↔ owner at lease milestones (move-in, mid-lease, move-out).
4. Admin app:
   - User & KYC review (approve/reject with reason).
   - House and listing moderation queue.
   - Fee/commission config (single source of truth for rates).
   - Dashboards: active users, GMV, overdue, ticket SLA.
   - Audit log viewer.
5. AuditLog middleware for sensitive mutations (auth, payments, config, KYC).

Acceptance:

- Tenant raises a ticket → owner sees push/email → resolves → tenant rates → rating visible in admin.
- Admin can suspend a user; that user is blocked across all apps on next request.

---

### Phase 4 — Campaigns (Week 11–12)

Goal: owners can list vacant units; prospects can apply; flow converts to a lease.

1. Campaign model: linked to a vacant unit, photos, price, terms, visibility (`draft`/`pending`/`live`/`closed`), expiry.
2. Owner: create campaign, submit for moderation, edit, close.
3. Admin: moderation queue with approve/reject + reason.
4. Public campaign feed (route inside the Tenant app, available pre-login as a marketing surface).
5. Application flow: prospect applies (basic profile, ID upload), owner accepts/rejects, acceptance creates a draft `Lease` ready to finalize.
6. Anti-spam: per-account application rate limit.

Acceptance:

- Full flow: owner posts → admin approves → prospect applies → owner accepts → draft lease appears in owner app.

---

### Phase 5 — Partner marketplace (Week 13–15)

Goal: partners can be booked for tickets and standalone jobs; commission is tracked.

1. PartnerProfile: KYC, service area, service catalog with pricing.
2. Service & ServiceJob models. Job lifecycle: `requested` → `quoted` → `accepted` → `in_progress` → `completed` → `rated`. Cancellation paths with reason codes.
3. Owner: book a partner from a ticket or directly. See quotes, accept, schedule.
4. Partner app: incoming requests, quote, accept/decline, status updates, photo proof of work.
5. Payment + commission: charge owner, split to partner payout ledger, hold/release on completion + cooldown.
6. Ratings (owner ↔ partner) feed back into discovery ranking.

Acceptance:

- Owner books partner from a ticket → partner completes → payment settles → both rate → ledger entries balance.

---

### Phase 6 — Hardening (Week 16)

Goal: production-ready.

1. Playwright e2e for critical flows: login per role, pay bill, raise + resolve ticket, post + approve campaign, book + complete partner job.
2. Load test payment + webhook paths with k6 (target: 95p < 500ms at 50 rps).
3. Backups: nightly Postgres dump → object storage, 30-day retention. Documented restore procedure.
4. Monitoring: Sentry alerts wired to a channel, uptime checks on each app + API, queue depth alerts.
5. Runbook in `docs/runbook.md`: incidents, rollbacks, common ops.
6. Security pass: dependency audit, rate limits, CSP headers, secrets rotation policy.

Acceptance: all e2e green in CI; runbook reviewed; backup restore tested on a throwaway DB.

---

## 6. Working rhythm with Claude Code

For every feature:

1. **Spec first.** Create `docs/specs/<feature>.md` from `docs/specs/_template.md`. Include: user story, screens, API shape, data model changes, edge cases, acceptance.
2. **Schema + types.** Update `packages/db` and `packages/shared`. Migrate. Get types green across the repo.
3. **API.** Add the Nest module mirroring the `houses` reference. Tests alongside.
4. **Client.** Build the screens, reusing `packages/ui`. Forms via Zod + react-hook-form.
5. **E2E.** Add one Playwright happy-path test in `apps/e2e`.
6. **PR.** Reference the spec. Keep under ~500 LoC of generated code.

**Rules of engagement**

- Always read the relevant `CLAUDE.md` files before touching a package.
- Never invent fields; check the Prisma schema first.
- Never bypass Zod validation at module boundaries.
- Never edit a shipped migration; create a new one.
- Money: integers + currency, always. No floats.
- Auth, payments, RBAC, KYC: human review required on every PR.

---

## 7. Definition of done (per task)

A task is done only when **all** are true:

- Types pass (`pnpm turbo typecheck`).
- Lint passes (`pnpm turbo lint`).
- Unit tests added and passing.
- For API changes: e2e test covers the new endpoint.
- For UI changes: screen renders correctly on a 375px viewport.
- For schema changes: migration applies cleanly on a fresh DB.
- Docs updated: relevant `CLAUDE.md` and the feature spec.
- PR description references the spec and lists manual test steps.
- No `TODO` / `FIXME` left without a linked issue.

---

## 8. Open decisions

Track here so we don't re-debate them mid-build:

- [ ] Payment provider for VN market (VNPay vs MoMo vs both).
- [ ] OTP transport provider (Twilio Verify, local SMS gateway, or email-only at start).
- [ ] Single-app vs subdomain-per-role deployment topology.
- [ ] Default currency, timezone, language (and whether i18n is needed in v1).
- [ ] Contract e-signature — v1 or v2?

When decided, move the item to an ADR under `docs/adr/`.
