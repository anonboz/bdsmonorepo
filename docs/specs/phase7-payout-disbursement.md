# Spec: Partner payout disbursement (phase 7.6)

> Status: **implemented (Stripe Connect deferred — §11)**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

5.4 ships partner payouts as a `JobLedgerEntry` ledger: a job
COMPLETED mints a `PAYOUT` row `HELD` with a 3-day cooldown, then
the daily sweeper flips it to `RELEASED`. **But no money actually
moves.** The partner sees "Released $45,000" in their app and is
expected to trust that the platform owes it to them.

7.6 closes that loop with a **manual bank-transfer queue**:
admins see a queue of RELEASED entries, send the money via their
banking app, then mark the row `DISBURSED` with a transfer
reference. The partner's UI surfaces the disbursement so they
can match it against their bank statement.

We deliberately skip Stripe Connect: it requires partner
onboarding (Express accounts, KYC, bank-account linking) that
isn't realistic for the VN-market partner base. The schema
leaves room for `STRIPE_CONNECT` as a future
`PayoutDisbursementMethod`, but the v1 UI + API only know
`MANUAL_BANK_TRANSFER`.

## 2. User stories

- As an **admin**, I want a single page listing all `RELEASED`
  payouts with the partner's name, amount, and currency so I can
  process them in one sitting without scrolling per-partner.
- As an **admin**, after sending a bank transfer I want to click
  "Mark disbursed" on the row and enter the bank reference. The
  partner's app updates within seconds.
- As a **partner**, I want my "Released" pile to drop and a
  "Disbursed" pile to grow as the platform settles up. Per row,
  I want to see when + how + the bank reference.
- As an **operator**, the audit log records every disbursement
  with the admin actor + the bank ref so disputes have a paper
  trail.

## 3. Surfaces

| Surface          | App / file                                         | Notes                                 |
| ---------------- | -------------------------------------------------- | ------------------------------------- |
| Schema           | `packages/db/prisma/schema.prisma`                 | DISBURSED enum + 4 columns + new enum |
| Service          | `apps/api/src/payouts/payouts.service.ts`          | `listAdminPending` + `markDisbursed`  |
| Admin controller | `apps/api/src/payouts/payouts.admin.controller.ts` | `/v1/admin/payouts/*`                 |
| Admin UI         | `apps/admin/app/(authed)/payouts/page.tsx`         | Queue + dialog                        |
| Partner UI       | `apps/partner/app/(authed)/payouts/page.tsx`       | New DISBURSED summary + per-row ref   |
| Shared schema    | `packages/shared/src/schemas/payouts.ts`           | Extended `jobLedgerEntrySchema`       |

## 4. Data model

### 4.1 Schema additions

```prisma
enum PayoutEntryStatus {
  PENDING       // CHARGE + COMMISSION default
  HELD          // PAYOUT during cooldown
  RELEASED      // sweeper flipped after cooldown — owed but not yet sent
  DISBURSED     // (new) admin sent the bank transfer
}

enum PayoutDisbursementMethod {
  MANUAL_BANK_TRANSFER   // v1: admin sent the transfer + recorded it
  STRIPE_CONNECT         // placeholder; not wired in v1
}

model JobLedgerEntry {
  // existing fields

  /// When the disbursement was actually settled (admin marked it).
  /// NULL until status == DISBURSED.
  disbursedAt        DateTime?
  /// Bank ref, wire id, Stripe transfer id, etc. Free-form text.
  disbursementRef    String?                   @db.VarChar(200)
  /// How the money moved. NULL until DISBURSED.
  disbursementMethod PayoutDisbursementMethod?
  /// User id of the admin who marked the row DISBURSED. Frozen at
  /// disbursement time; no FK to keep `cancelledBy`-style consistency
  /// (text references, audit row has the actor relation).
  disbursedById      String?

  @@index([status, releasedAt])      // existing
  @@index([status, disbursedAt])     // ops queries by recently-disbursed
}
```

Migration: `payout_disbursement`. Forward-only — adds `DISBURSED`
to the existing enum (Postgres `ALTER TYPE … ADD VALUE`), creates
the new `PayoutDisbursementMethod` enum, adds four nullable
columns, and adds one index.

### 4.2 State machine update

```
PENDING (CHARGE, COMMISSION)
HELD   (PAYOUT during cooldown)
  ↓  (sweeper, after cooldownUntil)
RELEASED (owed but not yet sent)
  ↓  (admin marks via /v1/admin/payouts/:id/disburse)
DISBURSED (settled — bank ref captured)
```

`DISBURSED` is terminal. There's no "undo" in v1 (the bank
transfer is real money on the move; reversal goes through the
provider, recorded as a separate ledger correction in a future
slice).

## 5. API

### 5.1 Endpoints

| Method | Path                             | Role  | Description                                |
| ------ | -------------------------------- | ----- | ------------------------------------------ |
| GET    | `/v1/admin/payouts/pending`      | ADMIN | List `RELEASED` rows ready to be disbursed |
| POST   | `/v1/admin/payouts/:id/disburse` | ADMIN | Mark a row DISBURSED with method + ref     |

### 5.2 Request / response

```ts
// @repo/shared/schemas/payouts.ts

export const payoutDisbursementMethodSchema = z.enum(['MANUAL_BANK_TRANSFER', 'STRIPE_CONNECT']);

export const disbursePayoutSchema = z.object({
  method: payoutDisbursementMethodSchema,
  reference: z.string().trim().min(1).max(200),
  note: z.string().trim().min(1).max(500).optional(),
});
```

The existing `jobLedgerEntrySchema` gains the four new fields
(`disbursedAt`, `disbursementRef`, `disbursementMethod`,
`disbursedById`).

`STRIPE_CONNECT` is accepted by the schema but the service
**rejects** it with `payouts.disbursement_method_unsupported`
in v1 — when we wire Stripe Connect, the same enum value flips
on without breaking clients.

### 5.3 List shape (admin)

The admin queue projection inlines partner display name +
business name so the page doesn't have to do per-row lookups:

```ts
export const adminPendingPayoutSchema = jobLedgerEntrySchema.extend({
  partnerUserId: idSchema,
  partnerName: z.string(),
  partnerBusinessName: z.string().nullable(),
});
```

## 6. Validation

`POST /v1/admin/payouts/:id/disburse`:

1. Load the entry; 404 if not found OR not `kind: PAYOUT`.
2. Reject if `status !== 'RELEASED'`:
   - HELD → 422 `payouts.not_disbursable_held` (wait for cooldown).
   - DISBURSED → 422 `payouts.already_disbursed`.
   - PENDING (a CHARGE/COMMISSION row) → 422 `payouts.not_disbursable`.
3. Reject `STRIPE_CONNECT` with 501
   `payouts.disbursement_method_unsupported`.
4. Atomically:
   - Update the row: `status = DISBURSED`, `disbursedAt = now()`,
     `disbursementRef = input.reference`, `disbursementMethod = input.method`,
     `disbursedById = ctx.actorId`.
   - Write `payout.disburse` audit row with the actor + meta
     `{ entryId, jobId, accountUserId, amount, currency, method, reference }`.

No `$queryRaw FOR UPDATE` lock needed — two admins racing to
disburse the same row would both pass the status check and the
second update would still succeed (idempotent state transition);
the audit log captures both attempts so we'd see the duplicate.
For v1 we accept that; a real-world rate would warrant a lock.

## 7. Admin UI

`/payouts` (new page):

```
┌─ Pending payouts (12)  total VND 4,500,000 ───────────────┐
│  Partner         Amount       Released     Action          │
│  Pat Repairs     ₫45,000      2026-05-18   Mark disbursed │
│  Pia Brokerage   ₫120,000     2026-05-18   Mark disbursed │
│  …                                                          │
└────────────────────────────────────────────────────────────┘
```

"Mark disbursed" opens a dialog:

```
Method:   MANUAL_BANK_TRANSFER  ▼
Reference: ___________________   (e.g. VietcomBank TXN 12345)
Note:     ___________________   (optional)
[Cancel]  [Mark disbursed]
```

Method drop-down shows both values; Stripe Connect is greyed
out with a "coming in a later phase" tooltip.

Empty state: "All payouts are caught up." (Encouraging, since
ops just emptied the queue.)

## 8. Partner UI update

`/payouts` (existing): grows a third summary card:

```
┌─ Held ──────┐  ┌─ Released ─────┐  ┌─ Disbursed ─────┐
│ VND 90,000  │  │ VND 0          │  │ VND 4,200,000   │
└─────────────┘  └────────────────┘  └─────────────────┘
```

Per-row table gains a column for `disbursementRef` (when
DISBURSED) so the partner can match against their bank statement.

## 9. Audit

| Action            | Target                | Meta                                                                  | Actor |
| ----------------- | --------------------- | --------------------------------------------------------------------- | ----- |
| `payout.disburse` | `JobLedgerEntry:<id>` | `jobId`, `amount`, `currency`, `accountUserId`, `method`, `reference` | admin |

`note` deliberately not in meta — same shape as
`bill.payment.refund`. Persisted on the row's eventual fields for
ops investigation.

## 10. Edge cases

- **Disburse a row from a deleted partner** — won't 500. The
  `accountUserId` text doesn't have FK constraints; the row is
  still disburseable. Admin's call whether to actually transfer
  money to a deleted account.
- **Double-fire from two admins** — second attempt 422 with
  `payouts.already_disbursed`. The first write wins; the audit
  log shows the failed second attempt.
- **`disbursementRef` length** — capped at 200 chars to match
  bank-reference reality (most are under 50; 200 leaves slack
  for free-form notes embedded by treasury teams).
- **Reversing a disbursement** — out of scope. Treat as a
  separate ledger correction in a future slice.
- **Partner suspended after RELEASED** — admin still sees the
  row in the queue; whether to actually pay them is policy, not
  code. The audit + the suspended flag give ops everything they
  need.

## 11. Out of scope

- **Stripe Connect Express onboarding** — the schema reserves
  the enum value but neither the service nor the UI wires it.
  Add when there's a real partner subset that wants it.
- **VNPay / MoMo disbursement** — neither has a meaningful
  payouts API for our case. Manual bank transfer covers VN.
- **Per-partner payout schedules** — pay weekly / monthly /
  on-demand. v1 is admin-on-demand; scheduling lands when the
  partner base is bigger.
- **Bulk disburse** — "select 10 rows, mark all" — useful when
  the queue is big. Defer to first real ops feedback.
- **Reversal / clawback** — see §10.
- **Email notification to the partner** — Phase 8 wires Resend;
  until then the partner pulls the page.

## 12. Acceptance criteria

- [x] Migration `payout_disbursement` adds `DISBURSED` to the
      `PayoutEntryStatus` enum, creates
      `PayoutDisbursementMethod`, and adds the four columns +
      index.
- [x] `GET /v1/admin/payouts/pending` (ADMIN) returns RELEASED
      entries with partner display + business name.
- [x] `POST /v1/admin/payouts/:id/disburse` (ADMIN) flips
      RELEASED → DISBURSED with all four fields populated.
- [x] Rejects HELD (422 not_disbursable_held), DISBURSED (422
      already_disbursed), STRIPE_CONNECT (501
      disbursement_method_unsupported).
- [x] One `payout.disburse` audit row per disbursement.
- [x] Admin UI shows queue + dialog; empty state when caught
      up.
- [x] Partner UI shows DISBURSED summary card + per-row ref.
- [x] `pnpm turbo typecheck lint test` clean.

## 13. Manual test plan

1. Run a partner-job flow through to COMPLETED → ledger
   minted → wait for cooldown OR back-date `cooldownUntil` in
   the DB → sweeper flips to RELEASED.
2. Log in as admin → `/payouts` → see the row.
3. Click "Mark disbursed" → enter ref "TEST-001" + method
   MANUAL_BANK_TRANSFER → submit.
4. Row vanishes from the admin queue.
5. Log in as the partner → `/payouts` → DISBURSED card shows
   the amount; row shows "TEST-001".
6. Audit log has `payout.disburse` with the admin actor.

## 14. Rollout

- One additive migration. Existing RELEASED rows stay
  RELEASED until admin disburses them (no automatic backfill
  to DISBURSED).
- No env vars.
- Comms: dev changelog — "Admin payout disbursement queue
  live; Stripe Connect onboarding is a future ask."
