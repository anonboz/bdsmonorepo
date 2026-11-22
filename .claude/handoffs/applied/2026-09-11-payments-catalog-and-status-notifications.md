# Handoff — 2026-09-11 — payments catalog, VietQR, status notifications

Session commits (all on `main`, pushed): `5c17ca7`, `fd8e408`, `30d9e36`,
`c124fb8`, `61edaf4`, `ed5552f`, `76bb382`, `d054b8f`.

## 1. What we built

Three related slices. **Tenant notifications** now fire for admin system
announcements (fan-out to every current tenant), lease status changes,
invoice status changes, and maintenance request status changes — the last
three needed brand-new landlord PATCH routes (`/api/leases/:id`,
`/api/invoices/:id`, `/api/maintenance-requests/:id`) with transition tables,
plus an inline `StatusSelect` control on the lease detail and maintenance
pages. **Payments**: a new admin-managed `PaymentMethodCatalog`
(`/payment-methods` in admin), per-org `OrgPaymentSettings` (landlord
`/payment-settings` + `/api/payment-settings`), a VietQR payload builder in
`@repo/shared/vietqr`, and a "Pay this bill" card on the tenant bill detail
that renders bank details + a server-side QR image. Tenants can report a
cash / transfer payment (`POST /api/my-bills/:billId/payments` → pending
`Payment`); landlords confirm or reject on a new `/payments` page
(`/api/payments`, `/api/payments/:id`), which re-derives the invoice status.
Smaller: tenant home announcement card is one row with a "View all" link to
a new `/announcements` page; the redundant Notifications sidebar entry was
removed (the bell already links there); `@repo/db` now throws a named error
when `DATABASE_URL` is unset instead of `TypeError: Invalid URL`. New
dependency: `qrcode` (+ types) in `apps/tenant` only.

## 2. New invariants discovered

### Notification writes ride the same transaction as the event

- **Rule**: a producer never writes a `Notification` row outside the
  transaction that persists the thing it announces.
- **Enforced by**: every `notify*` helper in
  `apps/landlord/services/notification.service.ts`,
  `apps/admin/services/notification.service.ts` and
  `apps/tenant/services/notification.service.ts` accepts `db | TransactionClient`;
  all new producers (`setLeaseStatus`, `setInvoiceStatus`,
  `setMaintenanceRequestStatus`, `reportMyPayment`, `confirmPayment`,
  `rejectPayment`) call them with `tx`.
- **Why**: a notification about a change that rolled back sends tenants to a
  bill/lease that never changed. The reverse (change saved, no notification)
  silently breaks the "tenant is always told" contract.
- **Proposed home**: `claude-context/api-patterns.md` (or a new
  `domain/notifications.md` — see open questions). It was already implicit in
  the 2026-09-09 handoff; this session made it universal.

### Status transitions are whitelisted per model, and only the service decides

- **Rule**: lease, invoice and maintenance statuses only move along the
  transition tables in their service; the route and UI never pick a target
  status the table doesn't allow.
- **Enforced by**: `LEASE_TRANSITIONS`, `INVOICE_TRANSITIONS`,
  `MAINTENANCE_TRANSITIONS` in `apps/landlord/services/*.service.ts` throw
  `ConflictError` (→ 409). The UI option lists in `leases/[id]/page.tsx` and
  `maintenance/page.tsx` mirror the tables but are not the guard.
- **Why**: `paid → overdue`, `ended → active` etc. would corrupt billing and
  fire wrong notifications. Terminal states (`paid`, `void`, `ended`,
  `terminated`, `renewed`, `completed`, `cancelled`) have no exits.
- **Proposed home**: `claude-context/domain/leasing.md` and
  `domain/rent-billing.md` (the tables themselves), one line in root
  `CLAUDE.md` under "Route → service → Prisma".

### Invoice status is derived from settled payments, never set alongside a payment

- **Rule**: when a payment is confirmed, the invoice status is recomputed
  from `SUM(Payment.amount WHERE status = succeeded)` vs `invoice.amount`;
  nothing else writes `paid` / `partially_paid` on that path.
- **Enforced by**: `confirmPayment` in `apps/landlord/services/payment.service.ts`
  (`tx.payment.aggregate` inside the transaction). `void` is preserved.
- **Why**: two code paths writing invoice status (manual `setInvoiceStatus`
  and payment confirmation) will disagree; the aggregate is the source of
  truth. Manual `setInvoiceStatus` still exists for bookkeeping — see open
  questions.
- **Proposed home**: `claude-context/domain/rent-billing.md`.

### A tenant-offered payment method = admin-enabled ∩ org-accepted (∩ configured)

- **Rule**: the tenant app only shows, and only accepts a report for, a
  method that is enabled in `PaymentMethodCatalog` **and** listed in the org's
  `acceptedMethods` (and, for `bank_transfer`, has BIN + account + name).
- **Enforced by**: `getMyBill` / `reportMyPayment` in
  `apps/tenant/services/bill.service.ts` (both check the catalog row and the
  org list); `upsertPaymentSettings` in the landlord app rejects
  non-enabled keys with 409.
- **Why**: the admin switching a rail off must take effect everywhere at
  once; an org must not be able to advertise a method the platform doesn't
  support; a bank-transfer row without account details would render a
  broken QR.
- **Proposed home**: `claude-context/domain/rent-billing.md` (new
  "Payment methods" section).

### At most one pending Payment per invoice

- **Rule**: a tenant cannot report a second payment while one is pending.
- **Enforced by**: `reportMyPayment` throws `ConflictError` if any
  `Payment.status = pending` exists on the invoice. Not enforced by a DB
  constraint.
- **Why**: two pending rows for the same balance would double-notify staff and
  let a landlord confirm both, over-settling the invoice.
- **Proposed home**: `domain/rent-billing.md`; consider a partial unique index
  (open question).

### `PaymentMethodCatalog.key` is a `PaymentMethodKey`, not `PaymentMethod`

- **Rule**: catalog keys come from `PAYMENT_METHOD_KEYS` in
  `@repo/shared/payment-methods` (`bank_transfer | cash | card | ewallet |
  points`); the Prisma `PaymentMethod` enum on `Payment.method` is a
  different, older vocabulary (`card | bank_transfer | ach | cash | other`).
  Only `MANUAL_PAYMENT_METHODS` (`bank_transfer`, `cash`) can be written to
  `Payment.method` today because they exist in both.
- **Enforced by**: `reportSchema = z.enum(MANUAL_PAYMENT_METHODS)`; every
  reader filters with `isPaymentMethodKey`.
- **Why**: enabling `ewallet` in the catalog and then writing it to
  `Payment.method` fails at the DB (`ewallet` is not in the Prisma enum).
- **Proposed home**: `gotchas.md` now; resolve properly when a real rail is
  added (open question).

### `NOTIFICATION_TYPES` is a closed list mirrored in three places

- **Rule**: adding a value to `NOTIFICATION_TYPES` requires the same key in
  `apps/tenant/i18n/messages/{en,vi,zh}.ts › notifications.types` and in
  `TYPE_LABELS` in `apps/landlord/app/(dashboard)/notifications/notification-list.tsx`.
- **Enforced by**: TypeScript — `TYPE_LABELS: Record<NotificationType, string>`
  and the `en.ts` type block fail `tsc` if a key is missing. `vi`/`zh` are
  typed against `en`, so they fail too.
- **Why**: a missing label renders the raw key to users.
- **Proposed home**: `gotchas.md` (it's a "where else do I edit" note).

## 3. Gotchas hit during the build

### Next typed routes don't know a page until typegen runs

- **Symptom**: `tsc` failed with `"/announcements" is not assignable to
  RouteImpl<"/announcements">` right after creating the page, even with the
  dev server running.
- **Root cause**: `.next/types/routes.d.ts` is regenerated on `next dev`
  start / `next build` / `next typegen`, not on file creation (webpack mode).
- **Fix**: `npx next typegen` in the app, then `tsc` passes. Only the tenant
  app has `typedRoutes: true`; landlord/admin have it off.
- **Add to gotchas.md**: yes — every new tenant route will hit it.

### Vercel build died with `TypeError: Invalid URL` in the NextAuth route

- **Symptom**: `Collecting page data … /api/auth/[...nextauth]` →
  `ERR_INVALID_URL input: 'undefined'`.
- **Root cause**: `@repo/db` builds the `pg.Pool` config at **import** time
  (`new URL(process.env.DATABASE_URL!)`), and Next's page-data collection
  evaluates route modules during `next build`. The Vercel project had no
  `DATABASE_URL` in the Production environment.
- **Fix**: a guard that throws `[@repo/db] DATABASE_URL is not set…`
  (`c124fb8`). The real fix is the env var on the project; a follow-up build
  confirmed the variable was still missing at build time after the user
  "added" it — most likely scoped to Preview, or added to another project.
- **Add to gotchas.md**: yes — "DATABASE_URL is needed at build time, per
  Vercel project, Production scope" is not obvious.

### `next-env.d.ts` gets dirtied by every dev server start

- **Symptom**: `apps/<app>/next-env.d.ts` shows as modified in `git status`.
- **Root cause**: Next 16 rewrites the file's reference comment.
- **Fix**: leave it out of commits. Consider ignoring it or committing the
  Next-16 form once.
- **Add to gotchas.md**: maybe — low cost, recurring noise.

### Stopping a backgrounded `npm run dev` leaves the Node child listening

- **Symptom**: after `TaskStop`, ports 6100/6101/6104 still `LISTENING`.
- **Root cause**: the shell wrapper dies, the `next dev` child does not
  (Windows).
- **Fix**: `netstat -ano | findstr :6101` → `Stop-Process -Id`.
- **Add to gotchas.md**: yes, one line under dev setup.

### Reseed duplicated system announcements

- **Symptom**: "Welcome to the new tenant portal" twice on the tenant list.
- **Root cause**: `seed.ts › reset()` relied on `organization.deleteMany()`
  cascading; system announcements have `organizationId = null` so they
  survived every reseed.
- **Fix**: explicit `announcement.deleteMany()` (+ `paymentMethodCatalog`)
  in `reset()` (`d054b8f`).
- **Add to gotchas.md**: no — fixed at the source; but the general rule
  "every global (org-less) table needs an explicit delete in `reset()`" is
  worth one line in `prisma-patterns.md`.

### Grep-based page assertions match the serialized i18n bundle

- **Symptom**: `grep -c "Pay this bill"` returned 1 on a paid bill where the
  card must not render.
- **Root cause**: the tenant i18n provider ships the whole messages object to
  the client, so every string exists in the HTML inside `<script>`.
- **Fix**: strip `<script>` before asserting on visible text.
- **Add to gotchas.md**: no (testing technique), but worth remembering.

### Bash heredoc + embedded Python with `'''` died mid-command

- **Symptom**: `unexpected EOF while looking for matching '`.
- **Root cause**: the harness's Bash wrapper on Windows tripped on a large
  quoted heredoc; smaller ones worked.
- **Fix**: write the patch script to the scratchpad with the Write tool and
  `python <file>`.
- **Add to gotchas.md**: no — tooling, not project.

## 4. Contradictions with existing docs

1. **Root `CLAUDE.md` → "Reference docs (load on demand via @)"** lists
   `@claude-context/auth-rules.md`, `api-patterns.md`, `prisma-patterns.md`,
   `ui-rules.md`, `architecture.md`, `pwa.md`, `realtime.md`, `gotchas.md`,
   `domain/INDEX.md`. **The `claude-context/` directory does not exist in the
   repo.** Every `@` reference is dead. Either the directory was never
   committed, or it lives outside the repo. Proposed: create it from the
   handoffs (this and the three earlier ones) or delete the references.

2. **`.env.example` → "Realtime (Pusher Channels + Beams)"** and
   `turbo.json › build.env` list `PUSHER_*`. Nothing in any app or package
   imports Pusher; the bell polls every 60 s. Proposed: drop the block and
   the env passthrough, or mark it "planned, not wired".

3. **`docs/specs/*`** (e.g. `phase12-momo-payments.md`) describe
   `apps/api/src/payments/*.ts` (the retired NestJS stack) and `vnpay/return`
   pages that don't exist. They still say "Status: drafting". Proposed:
   move to `docs/specs/archive/` or add a banner "pre-rewrite, obsolete".
   The payments flow shipped this session is manual (cash/transfer +
   landlord confirmation), not a gateway.

4. **`_start-server.bat`** lists apps admin/api/owner/tenant/partner on
   ports 4000–4030 with `pnpm --filter @repo/*` — the pre-rewrite stack.
   Current apps are landlord 6100 … vendor 6105 under npm workspaces. It is
   untracked; delete or rewrite.

5. **Root `.npmrc`** carries pnpm-only keys (`auto-install-peers`,
   `shamefully-hoist`, …) that npm warns about on every command and on
   Vercel. The comment in it still talks about pnpm 9. Proposed: remove.

6. **`apps/landlord/services/maintenance.service.ts` header** said "Read-only
   for now — triage/status changes … are a later slice". Status changes now
   exist there; the comment was updated in `30d9e36`. Any doc that repeats
   "maintenance is read-only in landlord" is stale.

7. **Root `CLAUDE.md` › Migrations** says `prisma migrate deploy` via
   `DIRECT_URL`. Correct and followed. But the handoff prompt asks whether
   `pnpm schema:map` ran — **no such script exists** in `package.json` or
   `packages/db/package.json`. The prompt is stale on that point.

## 5. Schema changes

Two hand-written migrations, both applied with `prisma migrate deploy`
against `DIRECT_URL` (shared Supabase DB, same one Vercel uses):

| Migration | Change |
|---|---|
| `20260911120000_add_org_payment_settings` | new `OrgPaymentSettings` (1:1 `Organization`, cascade delete) with `acceptCash`, `acceptBankTransfer`, `cashInstructions`, `bankBin`, `bankName`, `bankAccountNo`, `bankAccountName` |
| `20260911140000_add_payment_method_catalog` | new `PaymentMethodCatalog` (`key` PK, `enabled`, `sortOrder`) seeded with 5 rows (bank_transfer + cash on); `OrgPaymentSettings.acceptedMethods String[] @default(["bank_transfer"])` added and back-filled from the two booleans, which were then **dropped** |

- Models added: `OrgPaymentSettings`, `PaymentMethodCatalog`. Modified:
  `Organization` (relation `paymentSettings`). Removed: none.
- `packages/db/src/index.ts` exports the two new model types.
- `pnpm schema:map`: **not run — the script does not exist** (see §4.7).
- No Prisma enum values added. Two **string** vocabularies were added in
  `@repo/shared`: `PAYMENT_METHOD_KEYS` (see invariant above) and three new
  `NOTIFICATION_TYPES` (`payment_reported`, `payment_confirmed`,
  `payment_rejected`) plus three from earlier in the session
  (`invoice_status_changed`, `lease_status_changed`,
  `maintenance_request_updated`). All are labelled in the three tenant locales
  and the landlord list.
- Seed (`packages/db/prisma/seed.ts`) now creates the catalog, gives Maple
  `acceptedMethods: ["bank_transfer","cash"]` + Vietcombank placeholder
  account `0123456789`, and resets announcements + catalog.

## 6. What should NOT be in the docs

- The specific bank list in `VN_BANKS` (22 NAPAS BINs) — data, will grow.
- The VietQR field layout / CRC details — documented in the module header,
  self-contained, no other code depends on the format.
- `qrcode` rendering as a PNG data URL at 352 px in the tenant page — an
  implementation choice, could become an `<svg>` any time.
- The transfer message format `RENT <unit> <MMyyyy> <last-4-of-bill-id>` —
  a product string, not a rule; only `sanitizeTransferMessage` (ASCII,
  ≤ 50 chars) is load-bearing.
- The `StatusSelect` native `<select>` component and the `LEASE_NEXT` /
  `INVOICE_NEXT` / `NEXT` option maps in pages — UI mirrors of the service
  tables; the tables are the invariant, not the dropdowns.
- The one-row announcement card / "View all" layout.
- The empty "trigger redeploy" commit `61edaf4` and the `next typegen`
  workaround — one-offs.
- Role gating chosen for the new routes (`owner|landlord|agent` for status
  and payment confirmation, `owner|landlord` for settings, `admin` for the
  catalog) — matches the existing pattern per route; belongs in
  `auth-rules.md` only if that file already enumerates routes.
- The 60-second bell polling interval.

## 7. Open questions

1. **Two writers of invoice status.** `setInvoiceStatus` (manual: staff can
   mark `paid` with no `Payment` row) and `confirmPayment` (derived from
   payments) coexist. Should manual `paid` be removed, or should it create a
   synthetic succeeded `Payment` (`method: other`) so the aggregate stays
   truthful? Affects `domain/rent-billing.md`.
2. **Should the "one pending payment per invoice" rule become a partial
   unique index** (`Payment(invoiceId) WHERE status = 'pending'`) instead of
   an application check? Cheap, closes a race between two tabs.
3. **`PaymentMethod` enum vs `PaymentMethodKey`.** When `ewallet` / `points`
   get a rail, do we extend the Prisma enum (migration) or migrate
   `Payment.method` to a string that references the catalog? Decide before
   the next rail; the current dual vocabulary is a trap.
4. **Should admin-enabled-but-org-not-accepted methods be visible to
   tenants** (greyed, "ask your landlord") or hidden as now? Product call.
5. **Where do notification rules live?** There is no
   `domain/notifications.md`; the producer/transaction rule and the
   type-mirroring gotcha span landlord, admin and tenant apps. Proposed: a
   new domain file rather than scattering across three per-app files.
6. **`claude-context/` is missing entirely** (§4.1). Is it meant to be
   generated from the handoffs by the "apply" prompt, or was it lost? This
   blocks every "proposed home" above.
7. **`DATABASE_URL` at build time.** Should `@repo/db` create the pool
   lazily (first query) so `next build` never needs the DB? It would let
   builds pass without the var and fail only at runtime — safer for CI,
   worse for catching misconfiguration early. Currently it throws at import.
8. **Reject reason.** `rejectPayment` records no reason; tenants only get a
   generic message. Add a `note` field to `Payment` or fold it into the
   notification body?
9. **Bank-details privacy.** Account number + holder name are rendered to
   any tenant on any lease of the org, and embedded in the QR. That is
   normal for VietQR, but confirm it's acceptable to show on the shared
   `/announcements`-style pages if that ever expands.
10. **`Payment.amount` on report = full outstanding.** Tenants can't report a
    partial cash payment. Is that intended for v1?
