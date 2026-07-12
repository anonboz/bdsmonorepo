# AI Coding Context Structure (Claude Code) — House-Renting Monorepo

> How to lay out the instruction/context files so an agent like Claude Code stays
> accurate in a large monorepo. Mirrors the reference project. The governing idea:
> **a small always-loaded root file that POINTS to deeper docs loaded on demand**
> (via `@path` references), so the agent pulls only what the task needs instead of
> drowning in one giant file.

---

## 1. The layered model

```
Always loaded            → CLAUDE.md (root)            small, high-signal, points onward
Loaded when in an app    → apps/<app>/CLAUDE.md        per-app rules, routes, session shape
Loaded on demand (@)     → claude-context/*.md         patterns, architecture, gotchas
Loaded when in a domain  → claude-context/domain/*.md  one file per business domain
Harness config           → .claude/                    settings, commands, handoffs
Cross-session memory     → memory/ + MEMORY.md         durable facts (optional)
```

Rule of thumb: if the agent needs it **every** turn, it goes in root `CLAUDE.md`.
If it needs it only **sometimes**, put it in `claude-context/` and reference it
from root with an `@`-path so the agent knows it exists and can load it.

---

## 2. File tree

```
house-renting/
├── CLAUDE.md                         # root guardrails (always loaded) — §3
├── apps/
│   ├── landlord/CLAUDE.md            # per-app — §4
│   ├── tenant/CLAUDE.md
│   ├── agent/CLAUDE.md
│   ├── listings/CLAUDE.md
│   ├── admin/CLAUDE.md
│   └── vendor/CLAUDE.md
├── claude-context/
│   ├── architecture.md               # system overview, app boundaries, data flow
│   ├── package-architecture.md       # @repo/* boundaries + dependency direction
│   ├── auth-rules.md                 # NextAuth JWT, middleware, session shape, guards
│   ├── api-patterns.md               # route→service→prisma, response envelope, errors
│   ├── prisma-patterns.md            # multi-tenant scoping, migrations, singleton pool
│   ├── ui-rules.md                   # @repo/ui usage, Tailwind, mobile, z-index ladder
│   ├── realtime.md                   # Pusher channels/auth, notifications
│   ├── pwa.md                        # Serwist SW, offline queue, install prompt
│   ├── business-rules.md             # cross-cutting product rules (rent, screening, ...)
│   ├── gotchas.md                    # hard-won traps ("X silently breaks because Y")
│   ├── DECISIONS.md                  # append-only log of non-obvious decisions + why
│   └── domain/
│       ├── INDEX.md                  # pick-the-right-file index (load this first)
│       ├── leasing.md                # lease lifecycle, statuses, renewals
│       ├── rent-billing.md           # invoices, due dates, partial payments, late fees
│       ├── applications-screening.md # application flow, screening providers, decisions
│       ├── maintenance.md            # requests → work orders → vendors
│       ├── deposits.md               # hold/refund/forfeit rules
│       ├── feature-flags.md          # flag registry + "how to add a flag" contract
│       └── documents.md              # storage, soft-polymorphic pointers, signing
├── .claude/
│   ├── settings.json                 # shared harness settings (permissions, hooks)
│   ├── settings.local.json           # per-machine overrides (gitignored)
│   ├── CLAUDE_PARALLEL.md            # rules for running >1 agent session at once
│   ├── commands/                     # custom slash commands (*.md)
│   └── handoffs/                     # session handoff notes (design → build → retro)
└── packages/db/prisma/schema.prisma  # the schema is itself primary context
```

---

## 3. Starter root `CLAUDE.md`

```markdown
# CLAUDE.md (Root)

## Stack
Monorepo: 6 Next.js 16 apps (landlord :3000, tenant :3001, agent :3002,
listings :3003, admin :3004, vendor :3005). Prisma 7 + Postgres (Supabase),
NextAuth 4 JWT, Base UI + Tailwind 4, Zod 4, TanStack Query/Table, Serwist PWA.

## Foot-guns
- **Multi-tenant**: every org-owned query `where: { organizationId }`, orgId from
  session ONLY, assert ownership after `findUnique`. Global exceptions: `User`,
  `Vendor` marketplace, `Listing` search index.
- **Schema**: never invent fields; never modify schema without instruction.
- **Migrations**: manual SQL + `prisma migrate deploy` via `DIRECT_URL`. Never
  `migrate dev` / `db push` on the shared DB. See `prisma-patterns.md`.
- **`@repo/db` is server-only**; client files `import type` only. Never import
  `@repo/domain` inside `@repo/db` (domain → db only, no cycle).
- **Auth**: `decode` from `next-auth/jwt`; never `getServerSession`. Per-app
  cookie names (`landlord.session-token`, ...).
- **Money** is integer cents everywhere. Never float.
- **Connection pool**: singleton in `@repo/db`, `max: 3`. List `"pg"` in each
  app's `serverExternalPackages`.

## Code quality
- No `any`. Zod `.safeParse()` at every boundary. No business logic in components.
- Route → service → Prisma. `tsc --noEmit` must pass for all apps.
- Never hardcode fees/late-fee/currency — read org config.

## API response shape
`{ success: true, data }` / `{ success: false, error: { code, message } }`.
200/201/400/401/403/404/409/500.

## Reference docs (load on demand via @)
Schema: `packages/db/prisma/schema.prisma`
Patterns: `@claude-context/auth-rules.md`, `@claude-context/api-patterns.md`,
  `@claude-context/prisma-patterns.md`, `@claude-context/ui-rules.md`
Architecture: `@claude-context/architecture.md`, `@claude-context/package-architecture.md`
Domain: `@claude-context/domain/INDEX.md` (read it to pick the right file, then @-load that)
Gotchas: `@claude-context/gotchas.md`

## Per-app CLAUDE.md
Each app has `apps/<app>/CLAUDE.md` — read the one for the app you're in.

## Session state
If `SESSION_NOTES.md` exists at repo root, read it.
```

---

## 4. Starter per-app `CLAUDE.md` (e.g. `apps/landlord/`)

Keep it tight: identity, what it does / does NOT do, session shape, data rules,
route map, service files. Skeleton:

```markdown
# Landlord App — CLAUDE.md
> Read before every task in this app. Rules here override assumptions.

## App Identity
- App: Landlord (`/apps/landlord`), owner dashboard, org-scoped (all orgs the
  user is a member of; default active org from session).
- Runtime: Next 16 App Router, TS strict.

## Session Shape
```ts
interface Session {
  user: {
    id: string             // User.id
    organizationId: string // active OrgMembership.organizationId
    role: OrgRole          // landlord | agent | owner | admin
    name: string
  }
}
```
Login by email/phone; cookie `landlord.session-token`.

## Absolute Data Rules
1. Every org-owned query includes `organizationId` from the session.
2. Never return another org's data. Assert ownership after `findUnique`.
3. `organizationId` comes ONLY from `getSession()` — never body/params.

## Route Layout
/app/(dashboard)/{properties,units,listings,leases,rent,maintenance}
/app/api/{properties,leases,rent,maintenance}/...

## Service Layer
services/{property,lease,rent,maintenance}.service.ts — fat services, thin routes.

## Forbidden
- No cross-org reads. No schema edits. No raw Prisma in route handlers.
```

Do the same for tenant (renter-facing, own leases/payments/requests only), agent,
admin (global, cross-org — mark it as the ONE app that isn't org-scoped), etc.

---

## 5. `claude-context/domain/INDEX.md` pattern

A router the agent reads first, so it loads exactly one domain file:

```markdown
# Domain Index — read this, then @-load the one file you need.

| Touching... | Load |
|---|---|
| leases, terms, renewals, termination | `domain/leasing.md` |
| rent invoices, due dates, late fees, partial pay | `domain/rent-billing.md` |
| applications, screening, approve/reject | `domain/applications-screening.md` |
| maintenance requests, work orders, vendors | `domain/maintenance.md` |
| security deposits, refunds, forfeiture | `domain/deposits.md` |
| feature flags / adding a flag | `domain/feature-flags.md` |
| document upload/storage/signing | `domain/documents.md` |
```

Each `domain/*.md` holds: the models involved, the state machine (allowed status
transitions), invariants ("never X because Y"), and the service entry points.

---

## 6. `.claude/` harness config

- **`settings.json`** (committed) — shared permission allowlist, hooks, env. Keep
  machine-specific bits in `settings.local.json` (gitignored).
- **`commands/*.md`** — reusable slash commands (e.g. `/new-crud <Model>` that
  scaffolds a route→service→page slice following your conventions).
- **`handoffs/*.md`** — one file per significant feature: design decisions, what
  shipped, migrations applied, follow-ups. Invaluable for multi-session work.
- **`CLAUDE_PARALLEL.md`** — rules when running more than one agent at once
  (worktrees, shared DB caution, "read this before spawning a second session").

---

## 7. Writing rules that stick (lessons baked into the reference project)

1. **State the rule AND the why.** "orgId from session only — otherwise a
   landlord reads another org's leases." The why prevents plausible-wrong edits.
2. **Foot-guns as imperatives**, near the top, short. Agents skim.
3. **Point, don't inline.** Root file references `@claude-context/...`; deep
   detail lives there. Keeps root small enough to always load.
4. **One domain = one file**, indexed by `domain/INDEX.md`.
5. **`gotchas.md` is gold** — every non-obvious failure ("this 401 doesn't prove
   the route exists") becomes a one-paragraph entry so it's never re-learned.
6. **`DECISIONS.md` append-only** — records *why* a path was chosen, so the agent
   doesn't re-litigate settled choices.
7. **Keep the schema clean and commented** — `schema.prisma` is itself the most
   load-bearing context file; comment non-obvious columns inline.
8. **Update docs in the same change as the code.** A rule that drifts from the
   code is worse than no rule.

---

## 8. Bootstrap order

```
1. Write root CLAUDE.md (§3) — even a rough one immediately raises accuracy.
2. Add claude-context/{architecture, api-patterns, prisma-patterns, auth-rules}.md
3. Add apps/<app>/CLAUDE.md as you build each app.
4. Start domain/INDEX.md + one domain file per feature as you build it.
5. Seed gotchas.md the first time something silently breaks.
6. Add .claude/settings.json (permissions) + handoffs/ once work spans sessions.
```

Start minimal; grow the context files as the codebase teaches you what an agent
gets wrong. The structure scales — the reference project runs ~30 domain files +
per-app guides off this exact skeleton.
