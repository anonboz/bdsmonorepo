# Spec: Refunds + partial payments (phase 7.5)

> Status: **implemented (VNPay refunds deferred — out of scope §13)**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

7.1 → 7.4 ship the money-in side. 7.5 closes the loop with
money-out: the owner can refund a SUCCEEDED payment (full or
partial) and the bill walks back through `PARTIALLY_PAID` /
`ISSUED` accordingly. This unblocks real-world flows:

- Tenant overpaid by mistake → refund the excess.
- Maintenance dispute resolved in tenant's favour → partial refund.
- Lease cancelled before move-in → full refund of the deposit
  payment.

Providers supported in this slice: **MANUAL** (the owner records
that they sent money back via bank transfer) and **STRIPE** (we
call the Stripe Refunds API). **VNPay refunds are deferred** —
the VNPay refund endpoint requires a separate handshake with a
mandatory `vnp_RequestId` and runs async via a second IPN; out of
scope until we see real demand.

## 2. User stories

- As an **owner**, I can hit "Refund" on a SUCCEEDED payment and
  enter the amount. The bill flips PAID → PARTIALLY_PAID or
  PARTIALLY_PAID → ISSUED automatically.
- As an **owner refunding a Stripe payment**, the API actually
  calls Stripe so the tenant's card is credited — no manual
  step.
- As a **tenant**, the refund shows up on my bill's payments list
  as a negative-amount line so I see what's been returned.
- As an **operator**, every refund has a `bill.payment.refund`
  audit row linking the refund row to the original payment.

## 3. Surfaces

| Surface              | App / file                                                                        | Notes                            |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------- |
| Refund endpoint      | `POST /v1/houses/:h/units/:u/leases/:l/bills/:b/payments/:p/refund`               | OWNER only                       |
| PaymentsService      | `apps/api/src/payments/payments.service.ts`                                       | New `refundForOwner` method      |
| StripeService        | `apps/api/src/payments/stripe.service.ts`                                         | New `createRefund` wrapper       |
| Webhook updates      | `apps/api/src/webhooks/webhooks.service.ts`                                       | Capture PI / TxnNo on completion |
| Owner refund dialog  | `apps/owner/app/(authed)/houses/[id]/units/[u]/leases/[l]/bills/[b]/_components/` | Inline button per Payment row    |
| Tenant payments view | `apps/tenant/app/(authed)/my-bills/[billId]/page.tsx`                             | Negative lines styled            |

## 4. Data model

### 4.1 Schema additions

```prisma
model Payment {
  // existing fields

  /// Provider's settled-transaction id. Distinct from `providerRef`
  /// which is the session/checkout id created at start. Populated by
  /// the webhook handlers when the payment confirms:
  /// - Stripe: PaymentIntent id (`pi_…`).
  /// - VNPay: `vnp_TransactionNo`.
  /// - MANUAL: stays null.
  /// We use this to issue refunds via the provider API.
  providerCaptureRef String?

  /// Pointer to the original SUCCEEDED Payment a refund row is
  /// reversing. NULL on regular charges. Self-relation with a
  /// SetNull on delete so deleting a charge doesn't dangle a refund
  /// (deletes shouldn't happen, but the FK lives forever).
  refundOfPaymentId String?
  refundOf          Payment?  @relation("PaymentRefund", fields: [refundOfPaymentId], references: [id], onDelete: SetNull)
  refunds           Payment[] @relation("PaymentRefund")

  @@index([refundOfPaymentId])
}
```

Migration: `payment_refunds`. Two columns + an FK + an index. No
backfill — existing rows have null for both fields, which is the
correct initial state.

### 4.2 Sign convention

A refund is a Payment row with:

- `amount` < 0 (negative minor units; we store the refund as
  `-refundAmount`)
- `status` = `SUCCEEDED` (the refund itself succeeded)
- `provider` = same as the original payment's provider
- `refundOfPaymentId` = original payment's id

The bill state recompute uses `SUM(amount WHERE status=SUCCEEDED)`,
which now nets refunds. No code change needed in the recompute
helper — negative amounts subtract naturally.

The existing `recordManualPaymentSchema.amount.positive()` stays
positive — refunds go through a different endpoint with its own
schema. The DB column accepts signed integers (no CHECK
constraint).

## 5. API shape

```ts
// @repo/shared/schemas/payments.ts (additions)
export const refundPaymentSchema = z.object({
  /** Refund amount in minor units; must be positive. The service
   *  negates it before insert. */
  amount: z.number().int().positive(),
  /** Owner's note — same shape as the manual-record path. */
  reason: z.string().trim().min(1).max(500).optional(),
});
```

Endpoint:

| Method | Path                                                           | Role  | Description                |
| ------ | -------------------------------------------------------------- | ----- | -------------------------- |
| POST   | `/v1/houses/:h/units/:u/leases/:l/bills/:b/payments/:p/refund` | OWNER | Refund a SUCCEEDED Payment |

Response: same `recordPaymentResponseSchema` from 7.1 — the new
refund Payment row plus the updated Bill.

## 6. Validation pipeline

```
1. Owner-of-lease guard         (assertOwnerOfLease, same as 7.1)
2. Load original Payment        (must exist + belong to bill on path)
3. Original.status MUST be SUCCEEDED — else 422 payments.not_refundable
4. Original.amount MUST be > 0  — refunds-of-refunds not allowed
5. Compute already-refunded     = SUM(refunds.amount where refundOfPaymentId = original.id)
                                   (sum is ≤ 0; absolute value = already returned)
6. refundable                   = original.amount + alreadyRefundedSum
7. input.amount > refundable    → 422 payments.refund_exceeds_remaining
8. Dispatch by provider:
   - MANUAL  → no external call. Just insert.
   - STRIPE  → require providerCaptureRef; call stripe.refunds.create({ payment_intent, amount });
              503 if Stripe isn't enabled.
   - VNPAY   → 501 payments.refund_not_supported (deferred).
9. Insert refund Payment row    (amount = -input.amount, status = SUCCEEDED,
                                  provider = original.provider,
                                  refundOfPaymentId = original.id,
                                  providerRef = stripe refund id when STRIPE).
10. Recompute Bill status from SUM(SUCCEEDED.amount) vs total.
11. Audit bill.payment.refund   { originalPaymentId, amount, currency, provider,
                                  billPreviousStatus, billNextStatus, reason?: redacted }.
```

Race protection: step 5-10 run inside one `$transaction` with a
`SELECT … FOR UPDATE` on the bill row (same shape as 7.1's
record-payment guard).

## 7. Stripe refund call

```ts
const refund = await stripe.refunds.create({
  payment_intent: original.providerCaptureRef!,
  amount: input.amount, // already minor units; Stripe agrees
  reason: 'requested_by_customer', // mapped from input.reason if present
  metadata: { billId, originalPaymentId },
});
// refund.id → store as the new Payment row's providerRef.
```

Why `providerCaptureRef` is required for Stripe: the refund API
keys on `payment_intent`, not on session. The session id we
stored as `providerRef` is gone the moment Stripe finalises the
intent. We capture the PI in the webhook handler — see §8.

Async note: Stripe refunds are typically `succeeded` synchronously
for fresh charges. For older charges or dispute-related refunds
they can be `pending`. v1 trusts the synchronous response:
`succeeded` → we mark the row SUCCEEDED; `pending` → PENDING
(rare; ops triage). A future `charge.refunded` / `charge.refund.updated`
webhook handler can flip pending refunds; out of scope here.

## 8. Webhook captures `providerCaptureRef`

Today's 7.3 + 7.4 webhook handlers don't persist the settled-
transaction id. We extend both:

- **Stripe `checkout.session.completed`** — pull `event.data.object.payment_intent`
  and write to `Payment.providerCaptureRef`. Stripe types it as
  `string | Stripe.PaymentIntent | null`; we coerce strings only
  (the live wire format) and log a warning if it's null (a
  zero-amount session, which we shouldn't be creating).

- **VNPay IPN** — `vnp_TransactionNo` from the query string. We
  already stash it in `note`; now mirror it into
  `providerCaptureRef` (keep `note` for compatibility — it's
  free-form text and ops scripts may already grep it).

Both updates land in the same `$transaction` as the Payment
status flip so we don't get a half-written row.

## 9. Bill state machine

The recompute already handles arbitrary sums; no change. Edge
cases:

- Bill `PAID` → refund partial → bill `PARTIALLY_PAID`.
- Bill `PAID` → refund full → bill `ISSUED`. (Not `PAID` minus
  nothing — by convention, a fully refunded bill is `ISSUED`
  again, ready for re-payment or void.)
- Bill `PARTIALLY_PAID` → refund of all paid amount → bill
  `ISSUED`.
- Refunding more than `sum(SUCCEEDED)` → caught earlier at
  validation step 7.

Status `VOID` is owner-set via a separate flow that doesn't exist
yet (out of scope); a `VOID` bill rejects refunds the same way
the `record-payment` path does.

## 10. Permissions

- **OWNER** of the lease: may refund.
- **ADMIN**: not in this slice. Admin refund-on-behalf is the
  same tribal-knowledge ops issue we avoid in 7.1 (admin recording).
- **TENANT**: cannot refund. Disputes go through the support flow
  (out of scope) which eventually triggers an owner action here.
- Cross-party access: 404, same as everywhere.

## 11. Audit

| Action                | Target         | Meta                                                                                          | Actor |
| --------------------- | -------------- | --------------------------------------------------------------------------------------------- | ----- |
| `bill.payment.refund` | `Payment:<id>` | `originalPaymentId`, `amount`, `currency`, `provider`, `billPreviousStatus`, `billNextStatus` | owner |

The `reason` text is NOT in the meta — same precedent as 7.1's
`note` exclusion (PII shape). The reason persists in the refund
row's `note` field for ops investigations.

## 12. Edge cases

- **Refunding a refund** — original.amount < 0 means it's a refund
  row; rejected at step 4.
- **Refunding a MANUAL payment that was actually never sent** —
  no external call; the local row flips. Owner accepts that
  this is a book-keeping refund; the actual money movement is
  whatever they did out-of-band.
- **Stripe refund declined (`status: 'failed'`)** — we throw
  and rethrow; the API returns 500. Sentry catches. No local
  row created.
- **Partial refunds across multiple original payments** — fine,
  each refund row links to its own original.
- **Network partition mid-Stripe-refund** — Stripe's refunds API
  is idempotent via `Idempotency-Key`; we pass the refund row
  id as the key (well, we pass it _before_ creating the row in
  one transaction; that's ordering). Simplest: use a UUID
  generated client-side as the idempotency key and store it on
  the row. v1 cuts this corner — single-shot only; retry is the
  operator's problem if a refund hangs.

## 13. Out of scope

- **VNPay refunds** — VNPay has an API for this, but it's another
  signed request + a delayed second IPN. Deferred to a follow-up
  slice; owners with VNPay payments to refund use the VNPay
  dashboard out-of-band, then record a MANUAL refund to keep our
  books straight.
- **Refund webhooks (`charge.refunded`)** — the synchronous API
  response is enough for v1; async-completing refunds are rare
  enough to handle by hand.
- **Stripe Connect transfer reversals** (partner payout
  side) — partner payouts haven't moved real money yet (Phase
  7.6); this slice is bill-level only.
- **Tenant-initiated refund request** — needs a comms flow; out
  of v1.
- **Receipts for refunds** — the 2.5 receipt generator could be
  extended to show refund lines; deferred.
- **Idempotency keys** — see §12; v1 ships without, will revisit
  if real ops issues surface.

## 14. Acceptance criteria

- [x] Migration `payment_refunds` adds `providerCaptureRef` +
      `refundOfPaymentId` + FK + index.
- [x] Webhook handlers persist `providerCaptureRef` from Stripe
      `payment_intent` / VNPay `vnp_TransactionNo`.
- [x] `POST .../payments/:p/refund` validates SUCCEEDED-only,
      computes already-refunded, rejects over-refund (422), and
      inserts a negative-amount Payment row linked via
      `refundOfPaymentId`.
- [x] STRIPE refund calls the Stripe Refunds API and stores the
      Stripe refund id as `providerRef`.
- [x] VNPay refund attempt returns 501
      `payments.refund_not_supported`.
- [x] Bill recomputes correctly across PAID → PARTIALLY_PAID /
      ISSUED.
- [x] One `bill.payment.refund` audit row per refund.
- [x] Owner UI: refund dialog per Payment row.
- [x] Tenant UI: refund line appears in the payments list with a
      negative amount.
- [x] `pnpm turbo typecheck lint test` clean.

## 15. Manual test plan

1. MANUAL flow: as owner, record a 500,000 VND MANUAL payment
   on an ISSUED bill — bill flips PAID. Open the bill detail,
   click "Refund" next to the payment, enter 200,000, submit.
   Bill flips PARTIALLY_PAID. Payments list shows
   `+500,000` then `-200,000`. Tenant view mirrors.
2. STRIPE flow: as tenant, pay via Stripe (sandbox). After the
   webhook flips bill PAID, as owner click Refund, enter full
   amount. Bill flips ISSUED. Stripe dashboard shows the refund
   on the PI.
3. VNPay flow: as owner, try refund on a VNPay payment → 501
   with `payments.refund_not_supported`. Doc the workaround
   (process via VNPay dashboard + record a MANUAL refund here).

## 16. Rollout

- One additive migration.
- No new env vars (Stripe + VNPay are reused).
- Comms: dev changelog — "Refunds live for MANUAL + STRIPE
  payments; VNPay refunds via dashboard + manual record for now."
