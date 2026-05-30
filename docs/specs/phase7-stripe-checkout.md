# Spec: Stripe Checkout for bills (phase 7.2)

> Status: **implemented (webhook reconciliation deferred to 7.3 — bills stay ISSUED until then)**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

7.1 lets the owner record offline payments. 7.2 lets the tenant
pay online — the natural other half. We use **Stripe Checkout**
(the hosted page) rather than Stripe Elements / a custom payment
form: hosted is PCI-compliant out of the box, ships in a few
hundred LoC, and matches v1 scope (no saved cards, no recurring
billing).

The webhook that flips the Bill to `PAID` is intentionally **out
of scope here** — 7.3 ships the signed + idempotent webhook
framework. Until 7.3 lands, a successful Stripe payment leaves
the Bill at `ISSUED` (the `Payment` row stays `PENDING`); the
success-return page acknowledges this. That's deliberate: don't
flip state optimistically when the truth lives at the provider.

## 2. User stories

- As a **tenant**, I want to tap "Pay online" on a bill and land
  on a hosted page where I can pay with a card — no app-side
  PCI scope.
- As a **tenant**, I want a success page after I pay that
  acknowledges Stripe took the money even if my bill is still
  shown as "issued" — confirmation comes from the webhook.
- As a **tenant**, I want a cancel page that makes it obvious no
  charge happened so I'm not afraid to back out.
- As an **operator**, I want the `Payment` row created at session
  time so we can correlate Stripe events to local rows when 7.3
  wires the webhook.

## 3. Surfaces

| Surface             | App    | Route / file                                        | Notes                                     |
| ------------------- | ------ | --------------------------------------------------- | ----------------------------------------- |
| Tenant pay button   | tenant | `/my-bills/[billId]` → `_components/pay-online.tsx` | Client component, POSTs + redirects       |
| Tenant success page | tenant | `/my-bills/[billId]/payment-success/page.tsx`       | "We're confirming…" — webhook lands later |
| Tenant cancel page  | tenant | `/my-bills/[billId]/payment-cancelled/page.tsx`     | "No charge made — try again"              |
| API endpoint        | api    | `POST /v1/me/bills/:billId/checkout`                | TENANT only                               |
| Stripe wrapper      | api    | `apps/api/src/payments/stripe.client.ts`            | Thin SDK wrapper for mocking              |

## 4. API shape

```ts
// @repo/shared/schemas/payments.ts (additions)
export const createCheckoutSessionResponseSchema = z.object({
  /** Stripe-hosted Checkout Session URL. Open in the same tab. */
  url: z.string().url(),
  /** Session id — surfaces in success-page query string. */
  sessionId: z.string().min(1),
  /** Local Payment row id created in PENDING state. */
  paymentId: idSchema,
});
```

### Endpoint

| Method | Path                            | Role   | Body | Description                                   |
| ------ | ------------------------------- | ------ | ---- | --------------------------------------------- |
| POST   | `/v1/me/bills/:billId/checkout` | TENANT | `{}` | Create a Stripe Checkout Session for the bill |

No body — everything (amount, currency, recipient) is derived from
the bill. The endpoint is rate-limited to the same 10/min ceiling
as `/v1/me/tickets` (already configured in `apps/api/src/main.ts`
on the global limit; no per-route entry needed for v1).

## 5. Stripe session shape

```ts
stripe.checkout.sessions.create({
  mode: 'payment',                              // one-shot, no subs
  payment_method_types: ['card'],
  customer_email: tenant.email,                 // pre-fill receipt
  client_reference_id: bill.id,                 // for webhook lookup
  metadata: { billId, tenantId, paymentId },    // ours, on the event
  line_items: [{
    quantity: 1,
    price_data: {
      currency: bill.currency.toLowerCase(),    // ISO 4217 lower-case
      product_data: { name: `Bill ${bill.id}`, description: ... },
      unit_amount: outstanding,                  // minor units, signed
    },
  }],
  success_url: `${TENANT_APP_URL}/my-bills/${billId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url:  `${TENANT_APP_URL}/my-bills/${billId}/payment-cancelled`,
});
```

Notes:

- **Amount = outstanding balance** (bill.total minus succeeded
  payments). If a partial MANUAL was recorded by the owner, the
  tenant pays only the remainder.
- **VND** is zero-decimal in Stripe; our minor-unit storage maps
  1:1 with what Stripe expects.
- **`client_reference_id` + `metadata.billId`** are both set so
  the webhook (7.3) has two ways to find the local row.
- **Session URL** is short-lived (24h default). We don't store it;
  the tenant clicks "Pay" again to get a fresh one.

## 6. Local Payment row

Insert _before_ returning the session URL so the row exists when
the webhook fires:

```ts
const payment = await prisma.payment.create({
  data: {
    billId,
    amount: outstanding,
    currency: bill.currency,
    status: 'PENDING',
    provider: 'STRIPE',
    providerRef: session.id, // unique via @@unique([provider, providerRef])
    note: null,
    receivedAt: null,
  },
});
```

The `(provider, providerRef)` unique constraint guarantees one
row per Stripe session.

Audit row written in the same transaction:

| Action                | Target         | Meta                                                            |
| --------------------- | -------------- | --------------------------------------------------------------- |
| `bill.checkout.start` | `Payment:<id>` | `billId`, `amount`, `currency`, `provider: STRIPE`, `sessionId` |

## 7. Env additions

| Var                     | Required | Default                 | Notes                                         |
| ----------------------- | -------- | ----------------------- | --------------------------------------------- |
| `STRIPE_SECRET_KEY`     | no       | unset                   | When unset, endpoint returns 503 / disabled   |
| `TENANT_APP_URL`        | no       | `http://localhost:4020` | Origin used in success / cancel URLs          |
| `STRIPE_WEBHOOK_SECRET` | no       | unset                   | Used by 7.3; documented here for the full set |

Endpoint refuses to run (`503 payments.provider_disabled`) when
`STRIPE_SECRET_KEY` is unset — keeps the API booting in dev
without forcing a Stripe key on every contributor.

## 8. Idempotency / dedupe

The tenant can hammer the button. Each click creates a new
Checkout Session + a new PENDING Payment row. Stripe deduplicates
by session id; the local table accumulates rows but only one will
ever flip to `SUCCEEDED` (whichever the user actually pays).

Stale PENDING rows are harmless — they're not counted in the
"outstanding balance" math (`status: SUCCEEDED` filter). A future
sweeper can expire them after 24h to keep the table clean.

Already-paid bill → 422 (same `PAYMENT_BILL_ALREADY_PAID` code as
the manual path).

## 9. UI

### 9.1 Pay button (`_components/pay-online.tsx`)

Client component on the tenant bill detail page. Renders:

- A primary button labeled "Pay online with Stripe" when the bill
  is in `ISSUED`, `PARTIALLY_PAID`, or `OVERDUE`.
- A disabled placeholder explaining "Stripe payments not enabled
  on this deploy" if the API returns 503.
- An error alert on any other failure.

On click:

```ts
const res = await api.post<CreateCheckoutSessionResponse>(`/v1/me/bills/${billId}/checkout`);
window.location.assign(res.url);
```

### 9.2 Success page

Static landing for the Stripe redirect (`?session_id=…`):

- "Thanks for your payment" headline.
- A note: "Stripe confirmed the payment. Your bill will update
  to `PAID` shortly after our system receives Stripe's
  webhook — usually a few seconds."
- A "Back to your bills" link.

### 9.3 Cancel page

- "No charge made."
- Quick "Try again" button that loops back to the bill detail.

## 10. Edge cases

- **Bill in PAID state** — endpoint returns 422
  `payments.bill_already_paid`.
- **Bill in DRAFT / VOID** — 422 `payments.bill_not_payable`.
- **STRIPE_SECRET_KEY unset** — 503 `payments.provider_disabled`.
  Tenant UI shows the disabled placeholder.
- **Tenant of a different lease** — 404 (existence-hiding), same
  shape as the rest of the API.
- **Stripe SDK errors** — bubble up as 500 `internal_error` via
  the ProblemFilter; Sentry captures.
- **Outstanding balance = 0** but bill not yet `PAID` (race with
  a MANUAL recording) — 422 `payments.bill_already_paid`.

## 11. Out of scope

- **Webhook handling** — 7.3.
- **Saved cards / customer object** — needs Stripe Customer
  creation per tenant; deferred to Phase 8+.
- **3DS challenge UX** — handled by Stripe Checkout end-to-end.
- **VNPay / MoMo** — 7.4.
- **Refunds** — 7.5.
- **Partner payout disbursement** — 7.6.
- **Locale / language** — Stripe Checkout supports
  `locale: 'vi'` etc. via the SDK; pin once we localize the
  rest of the app.

## 12. Acceptance criteria

- [x] `pnpm add stripe` in `apps/api` and Stripe client SDK
      wrapper exported.
- [x] `STRIPE_SECRET_KEY` + `TENANT_APP_URL` declared on
      `env.ts`; both optional.
- [x] POST `/v1/me/bills/:billId/checkout` returns
      `{ url, sessionId, paymentId }` and creates a PENDING
      Payment row tagged STRIPE.
- [x] Bill state guards mirror 7.1: PAID → 422, DRAFT/VOID → 422,
      tenant of-other-lease → 404.
- [x] `STRIPE_SECRET_KEY` unset → 503 `payments.provider_disabled`.
- [x] One audit row per session: `bill.checkout.start`.
- [x] Tenant UI: Pay button → redirect → success + cancel pages.
- [x] `pnpm turbo typecheck lint test` clean.

## 13. Manual test plan

1. Set `STRIPE_SECRET_KEY` (test key, `sk_test_…`) in
   `apps/api/.env`.
2. Generate a bill (Phase 2.5 path) and open the tenant bill
   detail page.
3. Tap "Pay online with Stripe" → lands on Stripe Checkout.
4. Use a Stripe test card (`4242 4242 4242 4242`) → completes.
5. Lands on `/my-bills/<id>/payment-success?session_id=cs_test_…`
   — confirms "we'll update your bill when the webhook lands".
6. Confirm a `Payment` row with `provider: STRIPE`, `status:
PENDING`, and the session id exists.
7. (After 7.3 ships) — the webhook flips the row to `SUCCEEDED`
   and the bill to `PAID`.

## 14. Rollout

- No migration (uses the existing `Payment` table).
- `STRIPE_SECRET_KEY` populated per-environment via the secrets
  manager (see `docs/operations/secrets-rotation.md` — adds an
  entry).
- Comms: dev changelog — "Stripe Checkout live for bills;
  webhook reconciliation lands in 7.3."
