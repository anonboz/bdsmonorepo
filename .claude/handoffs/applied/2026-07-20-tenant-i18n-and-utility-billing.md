# Handoff — Tenant i18n + utility billing chain (2026-07-20)

## 1. What we built

Two loosely related tracks in one session. **(a) Tenant i18n + read surfaces:**
a dependency-free i18n layer under `apps/tenant/i18n/` (config, `messages/{en,vi,zh}.ts`,
`translate.ts`, `provider.tsx` client context, `server.ts` cookie/Accept-Language
resolver, `locale-switcher.tsx`), wired through the root layout; extracted all
hardcoded strings in login/home/my-leases/nav; added a sign-out button; built the
previously-missing `/my-bills`, `/my-bills/[billId]`, and `/my-tickets` routes with
their services (`bill.service.ts`, `ticket.service.ts`) + API routes; enabled
`typedRoutes` in the tenant `next.config.ts`. **(b) Utility billing chain:** rewrote
`@repo/shared` `formatMoney` to render locale-aware VND (`đ`/`VND`, integer only);
added `InvoiceLineItem` (+ `InvoiceLineKind` enum) so bills itemize rent + metered
water (m³) / electricity (kWh); added `UtilityRateBound` (global, admin-managed
min/max gate) and `OrgUtilityRate` (per-org, owner-managed price/unit); built the
admin `/utility-bounds` and landlord `/utility-rates` management UIs + services +
APIs; and built landlord `/invoices` generation that prices utilities as
`consumption × the org's rate`. Two migrations ran. No packages added/removed.

## 2. New invariants discovered

1. **An invoice's `amount` must equal the sum of its `InvoiceLineItem.amount`, and each
   metered line's `amount` must equal `round(quantity × OrgUtilityRate.pricePerUnit)`.**
   - Enforced today in `apps/landlord/services/invoice.service.ts` (`generateInvoice`)
     and mirrored in `packages/db/prisma/seed.ts`.
   - Matters: the tenant list/detail and outstanding-balance math derive from both
     `invoice.amount` and the per-line amounts; if they diverge the total shown won't
     match the itemization, and `outstanding = amount − paid` becomes wrong.
   - Proposed home: `claude-context/domain/rent-billing.md`.

2. **An owner's `OrgUtilityRate.pricePerUnit` must fall within the admin's
   `UtilityRateBound[min,max]` for that kind.**
   - Enforced in `apps/landlord/services/utility-rate.service.ts` (`upsertUtilityRate`
     re-parses the price against the bound → 400).
   - Matters: the bound is the platform guardrail; a write that bypasses the service
     (raw Prisma) lets an org bill outside allowed prices.
   - Proposed home: `claude-context/domain/rent-billing.md` (or a new `utility-billing.md`).

3. **`UtilityRateBound` is platform-global (no `organizationId`); `OrgUtilityRate` is
   org-scoped.**
   - Enforced by schema shape + `admin/services/utility-bound.service.ts` (no org filter,
     `requireAdmin`) vs `landlord/services/utility-rate.service.ts` (filters
     `organizationId`).
   - Matters: adding a `where: { organizationId }` to `UtilityRateBound` (habit from the
     multi-tenant rule) returns nothing and silently breaks the gate; conversely omitting
     the org filter on `OrgUtilityRate` leaks/writes cross-org pricing.
   - Proposed home: root `CLAUDE.md` — add `UtilityRateBound` to the global-exceptions
     list alongside `User`, `Vendor`, `Listing`.

4. **Tenant message catalogs are compile-time exhaustive: every key in the `Messages`
   type must exist in `en.ts`, `vi.ts`, and `zh.ts`.**
   - Enforced by `apps/tenant/i18n/messages/en.ts` exporting `Messages` and `vi.ts`/`zh.ts`
     being typed `const x: Messages`; a missing/renamed key fails `tsc`.
   - Matters: a partial translation would otherwise fall back to the raw key path at
     runtime with no build error.
   - Proposed home: `apps/tenant/CLAUDE.md`.

## 3. Gotchas hit during the build

1. **"No seed data" / empty pages after reseeding.**
   - Symptom: tenant logged in but every list was empty; bills page looked broken.
   - Root cause: `db:seed` wipes+recreates all rows, so user IDs rotate. The browser's
     existing NextAuth JWT still *decodes* (valid signature) but its `userId` no longer
     exists, so `getSession()` succeeds and every `userId`-scoped query returns empty —
     no 401, just silence.
   - Fix: sign out / log back in (added the sign-out button partly for this).
   - Add to `gotchas.md`: **yes** — happened repeatedly and is non-obvious (stale session
     reads as "no data," not "logged out").

2. **`PrismaClientValidationError: Unknown field 'lineItems'` after a schema change.**
   - Symptom: runtime error on the new query even though the schema + code were correct.
   - Root cause: the running `next dev` process holds the *old* generated Prisma client in
     memory; `prisma generate` updates disk only.
   - Fix: restart the dev server after `prisma generate` (and after a migration).
   - Add to `gotchas.md`: **yes** (or `prisma-patterns.md`) — predictable trap during
     any schema iteration with a live dev server.

3. **`typedRoutes` rejected a runtime href.**
   - Symptom: `next build` failed — `router.push(callbackUrl)` "Argument of type 'string'
     is not assignable to 'RouteImpl<string>'".
   - Root cause: with `typedRoutes` on, `Route` is a literal-union; a value read from
     `useSearchParams()` isn't statically a known route.
   - Fix: cast the dynamic value `as Route` (imported from `next`) at that boundary.
   - Add to `gotchas.md`: **yes** — will recur wherever a runtime string is pushed.

4. **`prisma migrate deploy` is auto-blocked by the sandbox.**
   - Symptom: the migrate command was denied ("Production Deploy" classifier) because it
     writes to the shared Supabase DB.
   - Root cause/fix: expected guardrail — needs explicit user authorization each time.
   - Add to `gotchas.md`: **no** (environment/process behavior, not a code trap), but worth
     a one-liner in `prisma-patterns.md` if migrations are run often here.

5. **`next build` while `next dev` is running.**
   - Symptom: mixed/served-stale `.next`.
   - Root cause: both write the same `.next` dir.
   - Fix: stop dev, build, restart dev on a clean `.next`.
   - Add to `gotchas.md`: borderline — **maybe** as a short note.

## 4. Contradictions with existing docs

1. **The `docs/specs/phase11-*` i18n specs describe an architecture this repo doesn't
   have.** They (status "shipped") describe a shared `packages/i18n` package built on
   `next-intl`, locales `['vi','en']`, `defaultLocale = 'vi'`, cookie `bds-locale`, and
   apps named `owner`/`partner`. This repo has none of that; we built an in-app,
   dependency-free i18n under `apps/tenant/i18n/`, locales `en|vi|zh`, `defaultLocale = 'en'`,
   cookie `tenant.locale`, tenant-only, apps `landlord`/`agent`/etc. Proposed correction:
   mark those specs as historical/aspirational, or note the current i18n is tenant-local
   and un-migrated to a shared package.

2. **`docs/specs/phase11-formatters.md` defines `formatMoney(minor, currency, locale)`
   with a per-currency `MINOR_UNIT_DIGITS` table.** We changed the shared helper to
   `formatMoney(cents, locale)` — currency hardcoded to VND, label `đ`/`VND` by locale,
   always `/100`, integer output. Proposed correction: update the formatter spec to the
   single-currency signature, or (see Open Questions) decide whether currency should be a
   parameter/org-config again.

3. **Root `CLAUDE.md`: "Never hardcode rent/fees/late-fee/currency — read org config."**
   `formatMoney` now hardcodes VND as the display currency. Rent/fees are still read from
   data; only the *display currency* is fixed. Contradiction is narrow but real — see
   Open Questions.

## 5. Schema changes

Two migrations ran (via `prisma migrate deploy`, `DIRECT_URL`):

- `20260720120000_add_invoice_line_items`
  - Added enum `InvoiceLineKind` (`rent`, `water`, `electricity`, `other`).
  - Added model `InvoiceLineItem` (`kind`, `description?`, `quantity Float?`, `unit?`,
    `amount Int`, FK → `RentInvoice`, cascade). Added `RentInvoice.lineItems` back-relation.
- `20260720130000_add_utility_rates`
  - Added model `UtilityRateBound` (global: `kind @unique`, `unit`, `minPricePerUnit`,
    `maxPricePerUnit`).
  - Added model `OrgUtilityRate` (`@@unique([organizationId, kind])`, `unit`,
    `pricePerUnit`, FK → `Organization`, cascade). Added `Organization.utilityRates`.
- **`pnpm schema:map` / `schema:map`: NOT run this session.** Should be run before docs
  are updated so any generated schema map reflects the three new models + enum.
- New enum values other code must handle: `InvoiceLineKind`. Tenant renders labels via
  `tenant.bills.detail.lineKinds.*` + `t(\`lineKinds.${kind}\`)`; landlord/admin utility
  UIs only handle `water`/`electricity`. Any new kind needs a tenant catalog label.

## 6. What should NOT be in the docs

- Temporary/debug scripts left in the tree or referenced (`scripts/test-*.mjs`,
  `scripts/check-user.mjs`, ad-hoc `packages/db/check-seed.mjs` — deleted).
- The demo September invoice generated during verification (real row in the dev DB; a
  `db:seed` clears it).
- Concrete seed magnitudes (water 2000¢/m³, electricity 300¢/kWh, the sample consumption
  numbers, bound ranges) — example data, not rules.
- Styling/UI-layout choices (table markup, sidebar placement of the switcher/sign-out).
- The decision to hand-roll i18n instead of `next-intl` (implementation choice; the
  divergence itself is captured under Contradictions).
- Per-file naming choices.

## 7. Open questions

- **Currency: hardcoded VND vs org config.** Root `CLAUDE.md` says read currency from org
  config; `formatMoney` now fixes VND. Is this a permanently single-currency (VND) platform,
  or should currency return as a parameter / org setting?
- **VND vs the "cents" money model.** Values are stored as integer *cents* (2 minor units)
  but VND has no subunit; `formatMoney` divides by `100` for display. Keep storing cents and
  dividing, or migrate the money model to whole đồng? This affects what "price per unit" and
  invoice amounts *mean*.
- **Default locale.** We shipped `en`; the phase11 specs wanted Vietnamese-first (`vi`).
  Which is correct for this product?
- **i18n scope.** Stay tenant-only + in-app, or promote to a shared `@repo/i18n` and localize
  landlord/admin (currently English-only)?
- **Invoice status on generation.** `generateInvoice` always sets `status: "open"`; should it
  be `overdue` when `dueDate` is already past, and should generating recompute/lock consumption?
- **Admin utility catalog.** We deferred admin-managed utility *types/units* (kept the enum +
  fixed `m³`/`kWh`); do we still want a catalog model, or is the enum sufficient?
- **`typedRoutes` for the other apps.** Only tenant has it on; enable elsewhere (landlord/admin
  have known dead nav links today)?
