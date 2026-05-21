# Spec: Manual payment recording (phase 7.1)

> Status: **implemented**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

Bills today move only from `DRAFT → ISSUED`. There's no way to
record that one was actually paid — Phase 2 left payment provider
work for Phase 6, then Phase 6 explicitly pushed it to Phase 7.
The Phase 6 e2e for billing carries a note saying "no mark-paid
endpoint in v1; full payment end-to-end waits for payment
providers."

7.1 closes that gap with the simplest case: the **owner records a
manual payment** (cash, bank transfer, anything offline). No
external provider, no webhook. The Bill flips to `PARTIALLY_PAID`
or `PAID` depending on the amount. This is also the foundation
7.2 (Stripe Checkout) builds on — the `Payment` row + status
transition logic is shared across providers.

## 2. User stories

- As an **owner**, I want to mark a bill paid with the amount,
  date, and reference (e.g. bank transfer #ABCD) so the tenant
  app stops showing it as outstanding.
- As an **owner**, I want to record a partial payment so the
  bill shows the remaining balance until the tenant settles
  the rest.
- As a **tenant**, I want to see the payment history on a bill —
  who recorded what, when — so I can reconcile against my own
  records.
- As an **admin**, I want the audit log to carry every recorded
  payment with the actor + amount so disputes have an evidence
  trail.

## 3. Surfaces

| Surface              | App    | Route / file                                              | Notes                           |
| -------------------- | ------ | --------------------------------------------------------- | ------------------------------- |
| Owner record payment | owner  | `/houses/[id]/units/[u]/leases/[l]/bills/[b]` + dialog    | Form: amount, paidAt, ref, note |
| Payments list        | owner  | same page                                                 | Inline below the bill summary   |
| Tenant payments view | tenant | `/me/bills/[b]`                                           | Read-only payment history       |
| API record           | api    | `POST /v1/houses/:h/units/:u/leases/:l/bills/:b/payments` | Owner only                      |
| API list (owner)     | api    | `GET /v1/houses/:h/units/:u/leases/:l/bills/:b/payments`  | Owner + admin                   |
| API list (tenant)    | api    | `GET /v1/me/bills/:b/payments`                            | Tenant of the lease             |
| New module           | api    | `apps/api/src/payments/`                                  | Mirrors the `houses` reference  |

## 4. API shape

```ts
// @repo/shared/schemas/payments.ts
export const paymentSchema = z.object({
  id: idSchema,
  billId: idSchema,
  amount: z.number().int().positive(),
  currency: currencySchema,
  status: paymentStatusSchema,
  provider: paymentProviderSchema,
  providerRef: z.string().nullable(),
  note: z.string().max(500).nullable(),
  /** ISO timestamp of when the money actually moved. Distinct from
   *  `createdAt` (when this row was inserted). */
  receivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const recordManualPaymentSchema = z.object({
  amount: z.number().int().positive(),
  currency: currencySchema,
  /** Bank ref, cheque number, transfer id — free-form, optional. */
  providerRef: z.string().trim().max(120).optional(),
  /** Owner's note for the audit trail. */
  note: z.string().trim().max(500).optional(),
  /** ISO date or datetime; defaults to now() server-side. */
  receivedAt: isoDateTimeSchema.optional(),
});
```

### Endpoints

| Method | Path                                                 | Role         | Description                        |
| ------ | ---------------------------------------------------- | ------------ | ---------------------------------- |
| POST   | `/v1/houses/:h/units/:u/leases/:l/bills/:b/payments` | OWNER        | Record a MANUAL payment            |
| GET    | `/v1/houses/:h/units/:u/leases/:l/bills/:b/payments` | OWNER, ADMIN | List payments on a bill            |
| GET    | `/v1/me/bills/:b/payments`                           | TENANT       | List payments on tenant's own bill |

Response shape on POST: the created `Payment` row plus the
updated `Bill` (so the client can show the new status without a
follow-up GET):

```ts
export const recordPaymentResponseSchema = z.object({
  payment: paymentSchema,
  bill: billSchema,
});
```

## 5. Data model

Existing `Payment` model gains a `note` field:

```prisma
model Payment {
  // … existing fields
  note      String?  @db.VarChar(500)
}
```

Migration: `payment_note`. Single `ALTER TABLE … ADD COLUMN`.

No other schema changes — `PaymentProvider.MANUAL`, `PaymentStatus.SUCCEEDED`, and `BillStatus.PARTIALLY_PAID` / `PAID` are all already defined.

## 6. State machine

After a new `Payment` row with `status: SUCCEEDED` is inserted,
the Bill's status is recomputed from scratch:

```
sumSucceeded = sum(Payment.amount where billId = bill.id
                   AND status = SUCCEEDED)
if sumSucceeded == 0           → bill.status = (current; unchanged)
if 0 < sumSucceeded < bill.total → bill.status = PARTIALLY_PAID
if sumSucceeded == bill.total  → bill.status = PAID
if sumSucceeded > bill.total   → REJECT (422 payments.overpayment)
```

Inputs:

- Bill must be in `ISSUED`, `PARTIALLY_PAID`, or `OVERDUE`.
  `DRAFT` → 422 (`payments.bill_not_payable`).
  `PAID` → 422 (`payments.bill_already_paid`).
  `VOID` → 422 (`payments.bill_not_payable`).
- `amount > 0` (Zod-enforced).
- `currency === bill.currency` (mismatched → 422 `payments.currency_mismatch`).
- `amount + existing succeeded` must not exceed `bill.total` (→ 422 `payments.overpayment`).
  Overpayment scenarios are handled by the refund flow in 7.5 — not silently accepted.

The whole insert + bill update is a single Prisma `$transaction`
so we don't get a half-flipped state if either query fails.

## 7. Audit

| Action                | Target         | Meta                                                                                                      | Actor |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------------------- | ----- |
| `bill.payment.record` | `Payment:<id>` | `billId`, `amount`, `currency`, `provider: MANUAL`, `providerRef`, `billPreviousStatus`, `billNextStatus` | owner |

`note` is intentionally **not** in the audit meta — same pattern
as `JobRating.comment` (Phase 5.5). The full row is in `Payment`
for ops investigations; the audit log doesn't mirror free-form
text.

## 8. Permissions

- **OWNER** of the lease: may POST + GET on the owner path.
- **ADMIN**: may GET on the owner path (for support / audit).
  Not POST — admins shouldn't record on behalf of an owner;
  that's tribal-knowledge ops we avoid.
- **TENANT** of the lease: may GET on `/v1/me/bills/:b/payments`.
- Cross-party access: 404 (existence-hiding), consistent with
  the rest of the API.

## 9. UI

### 9.1 Owner bill detail

The existing bill detail page (Phase 2.5) grows two sections at
the bottom:

- **Payments** — a small table with date, amount, provider,
  provider ref, recorded-by. Empty state: "No payments
  recorded yet."
- **Record payment** — a card with a form (react-hook-form +
  Zod). Fields: amount (defaulted to bill total minus
  outstanding), date (defaulted to today), provider ref,
  note. Submit → POST to the endpoint, refresh.

The form is hidden when the bill is in `PAID`, `VOID`, or
`DRAFT` — the API rejects anyway, but the UI shouldn't offer
the action.

### 9.2 Tenant bill detail

Read-only payments table. No "record payment" form — tenants
self-paying lands in 7.2 (Stripe Checkout).

## 10. Edge cases

- **Concurrent record** — two owners hitting POST simultaneously
  could both pass the "amount + existing ≤ total" check and then
  both insert. Mitigation: do the sum + insert + bill update
  inside the same `$transaction` with `SELECT … FOR UPDATE` on
  the bill row. (The bill row is the natural serialization point.)
- **Zero amount** — rejected by Zod (`positive()`).
- **Negative amount** — rejected by Zod.
- **Currency drift** — bill currency is locked at generation
  time; mismatched currency on the payment is a 422, not an
  attempt to convert.
- **MANUAL with a duplicate providerRef** — there's a
  `@@unique([provider, providerRef])` index on Payment from
  Phase 2; two MANUAL payments with the same `providerRef`
  would collide. Catch P2002 → 409 `payments.provider_ref_taken`.
  Owners can leave `providerRef` null to skip this.
- **`receivedAt` in the future** — accept (some accounting
  workflows pre-record cleared payments); reject > now + 1 day
  to limit nonsense.

## 11. Out of scope

- **Stripe / VNPay / MoMo providers** — 7.2 / 7.4.
- **Refunds** — 7.5.
- **Partial-then-full Stripe top-up** — also 7.5 (mixed-provider
  rolls).
- **Receipt regeneration after a payment** — the existing PDF
  receipt (Phase 2.5) renders from the bill alone; updating it
  to include payment lines is a follow-up.
- **Payment delete / void** — out of scope. Mistakes get
  corrected via a negative-amount adjustment in 7.5.
- **Tenant-initiated self-payment** — needs a provider; 7.2.

## 12. Acceptance criteria

- [x] `Payment.note` migration applies; schema regenerates.
- [x] `recordManualPaymentSchema` + `paymentSchema` exported from
      `@repo/shared`.
- [x] POST `/v1/houses/:h/units/:u/leases/:l/bills/:b/payments`
      with valid body inserts a Payment + flips the Bill to
      `PARTIALLY_PAID` or `PAID` correctly.
- [x] Overpayment → 422 `payments.overpayment`.
- [x] Recording on a `PAID`/`DRAFT`/`VOID` bill → 422
      `payments.bill_not_payable` (or `…bill_already_paid`).
- [x] One audit row per recording: `bill.payment.record`.
- [x] Owner UI: bill detail page renders payments + record form.
- [x] Tenant UI: bill detail page renders payments read-only.
- [x] e2e `bills.spec.ts` extended to record + assert PAID flip.
- [x] `pnpm turbo typecheck lint test` clean.

## 13. Manual test plan

1. As owner: open a bill from `/me/houses/<h>/units/<u>/leases/<l>/bills/<b>`.
2. Click "Record payment" → enter half the bill total → submit.
   Bill status flips to `PARTIALLY_PAID`. Payments table shows
   one row.
3. Record the remaining half → bill flips to `PAID`. Form
   disappears.
4. Try to record another payment → form is hidden; the API
   rejects if you hand-craft a POST.
5. As tenant for the same lease: open `/me/bills/<b>` →
   payments table mirrors the owner's. No record form.

## 14. Rollout

- One additive migration (`payment_note`).
- No flag.
- Comms: dev changelog — "Owner can mark bills paid; full
  payment flow lands in 7.2."
