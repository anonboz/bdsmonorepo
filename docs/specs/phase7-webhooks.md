# Spec: Provider webhooks framework (phase 7.3)

> Status: **implemented**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

7.2 creates Stripe Checkout Sessions and a local `Payment` row in
`PENDING` — but the Bill stays `ISSUED` because we never trust an
optimistic flip. The truth lives at Stripe, and Stripe tells us via
a webhook.

7.3 ships the framework that turns that webhook into a real state
transition. The pieces are **signature verification** (so an
attacker can't POST a fake `payment_intent.succeeded`),
**idempotency** (so duplicate deliveries don't double-credit),
**dispatch** (so Stripe events route to a handler that knows how
to update our domain), and a **WebhookEvent table** that gives ops
a place to look when a payment seems stuck.

The framework is per-provider; only Stripe ships in this slice.
VNPay's IPN (7.4) plugs into the same shape.

## 2. User stories

- As a **tenant** who just paid via Stripe Checkout, I want my
  bill to flip to `PAID` within seconds of finishing — not after
  I refresh or message my landlord.
- As an **operator**, I want every webhook delivery recorded with
  its event id, payload, and processing outcome so I can debug a
  "Stripe says paid, our app doesn't" report by reading one row.
- As a **security reviewer**, I want webhook payloads rejected
  unless they carry a valid `Stripe-Signature` so the public
  endpoint can't be abused.

## 3. Surfaces

| Surface              | App / file                                | Notes                                   |
| -------------------- | ----------------------------------------- | --------------------------------------- |
| Stripe webhook route | `POST /v1/webhooks/stripe`                | `@Public()`, raw body, sig-verified     |
| Webhooks module      | `apps/api/src/webhooks/`                  | Service + controller + handlers         |
| WebhookEvent table   | `packages/db/prisma/schema.prisma`        | New model + unique `(provider,eventId)` |
| Raw body parser      | `apps/api/src/main.ts`                    | Custom content-type parser              |
| StripeService        | `apps/api/src/payments/stripe.service.ts` | New `constructEvent()` helper           |

No UI — webhook plumbing is server-side only.

## 4. Endpoint

| Method | Path                  | Auth        | Description                        |
| ------ | --------------------- | ----------- | ---------------------------------- |
| POST   | `/v1/webhooks/stripe` | `@Public()` | Receives signed events from Stripe |

`@Public()` because Stripe doesn't carry a session cookie. The
gate is the `Stripe-Signature` header verified against
`STRIPE_WEBHOOK_SECRET`.

Stripe expects a `2xx` response within ~30s, otherwise it retries
with exponential backoff. We return:

- `200` on every successful dispatch (including duplicates — Stripe
  treats 200 as "stop retrying").
- `400` `payments.webhook_invalid` on signature mismatch.
- `503` `payments.provider_disabled` when `STRIPE_WEBHOOK_SECRET`
  is unset.
- `500` on internal handler error — Stripe retries.

## 5. Data model

```prisma
enum WebhookEventStatus {
  RECEIVED
  PROCESSED
  FAILED
}

model WebhookEvent {
  id          String              @id @default(cuid())
  provider    PaymentProvider
  /// Provider's event id (`evt_…` for Stripe). Unique per provider —
  /// re-deliveries collide here and short-circuit the handler.
  eventId     String
  /// Event name, e.g. `checkout.session.completed`. Free-form per
  /// provider; we don't enum it.
  type        String              @db.VarChar(120)
  /// Full payload as received, after signature verification.
  payload     Json
  receivedAt  DateTime            @default(now())
  processedAt DateTime?
  status      WebhookEventStatus  @default(RECEIVED)
  /// Set when `status = FAILED` — keeps the diagnostic on the row
  /// itself instead of buried in logs.
  error       String?             @db.VarChar(2000)

  @@unique([provider, eventId])
  @@index([provider, type, receivedAt])
  @@index([status, receivedAt])
}
```

Migration: `webhook_events`. Single new table + enum.

## 6. Pipeline

```
POST /v1/webhooks/stripe
  ├─ verify Stripe-Signature        (constructEvent throws → 400)
  ├─ INSERT WebhookEvent             (P2002 → already-processed → 200)
  ├─ dispatch by event.type          (handler runs in a $transaction)
  │   └─ on success: UPDATE WebhookEvent set status=PROCESSED, processedAt=now
  │   └─ on throw:   UPDATE WebhookEvent set status=FAILED, error=msg
  │                  then re-throw → 500 → Stripe retries
  └─ 200
```

Handlers are kept short — they read the event payload, mutate
Prisma, write an audit row, and return.

## 7. Handlers (this slice)

Only one event matters for the bill flow:

### `checkout.session.completed`

```ts
const session = event.data.object as Stripe.Checkout.Session;
const sessionId = session.id;

await prisma.$transaction(async (tx) => {
  const payment = await tx.payment.findUnique({
    where: { provider_providerRef: { provider: 'STRIPE', providerRef: sessionId } },
  });
  if (!payment) return; // session we didn't initiate — no-op, audit it
  if (payment.status === 'SUCCEEDED') return; // double-fire, idempotent
  await tx.payment.update({
    where: { id: payment.id },
    data: { status: 'SUCCEEDED', receivedAt: new Date() },
  });
  // Recompute bill status from SUM(succeeded payments).
  const agg = await tx.payment.aggregate({
    where: { billId: payment.billId, status: 'SUCCEEDED' },
    _sum: { amount: true },
  });
  const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
  const nextStatus = (agg._sum.amount ?? 0) >= bill.total ? 'PAID' : 'PARTIALLY_PAID';
  await tx.bill.update({ where: { id: payment.billId }, data: { status: nextStatus } });
  // audit `bill.payment.confirmed` with actorId: null
});
```

Other events (`payment_intent.payment_failed`,
`checkout.session.expired`, …) are **logged + acknowledged** but
don't currently change state. They'll get handlers as needed —
right now there's no UI for "payment failed" beyond the tenant
retrying.

## 8. Raw body

Stripe's signature is HMAC-SHA256 over the **exact bytes** of the
request body. Fastify's default JSON parser stringifies + reparses,
which can mutate whitespace. We add a custom content-type parser
that:

1. Reads the body as a string.
2. Stashes the raw string on `req.rawBody`.
3. Parses + returns the JSON for the global Zod pipe (every other
   route keeps working as today).

The parser runs on every `application/json` request. Cost: one
extra string allocation per request — negligible.

## 9. Signature verification

`StripeService.constructEvent(rawBody, signature)` wraps
`stripe.webhooks.constructEvent(...)` from the SDK. It throws a
`Stripe.errors.StripeSignatureVerificationError` on mismatch which
the controller catches and maps to 400
`payments.webhook_invalid`.

`STRIPE_WEBHOOK_SECRET` is read once at boot via the env loader
(already declared in 7.2's env work). When unset, the controller
returns 503 `payments.provider_disabled` so a misconfigured
deploy doesn't silently accept fake events.

## 10. Audit

| Action                   | Target              | Meta                                                                                          | Actor |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------- | ----- |
| `bill.payment.confirmed` | `Payment:<id>`      | `billId`, `amount`, `currency`, `provider`, `eventId`, `billPreviousStatus`, `billNextStatus` | null  |
| `webhook.received`       | `WebhookEvent:<id>` | `provider`, `type`, `eventId`                                                                 | null  |

`actor = null` is the established pattern for system-triggered
audit rows (see `payout.release` in 5.4).

## 11. Edge cases

- **Duplicate event delivery** — caught by
  `@@unique([provider, eventId])`. We catch P2002, set
  `processedAt` on the existing row to mark "we saw this again",
  return 200. Stripe stops retrying.
- **Unknown session id** — the event references a session we
  didn't create (lost row? Mongo-style replay? Stripe Connect?).
  Log + audit + return 200. Don't 500 — we'd just retry forever.
- **Payment already SUCCEEDED** — return 200, no-op. Probably a
  duplicate the unique constraint missed because we ack'd before
  inserting.
- **Bill missing** — log error, set WebhookEvent status to FAILED,
  return 500 so Stripe retries (this is genuinely broken state).
- **Signature missing** — same as mismatch: 400 `payments.webhook_invalid`.
- **`STRIPE_WEBHOOK_SECRET` unset** — controller 503s; doesn't
  attempt verification.

## 12. Out of scope

- **VNPay IPN** — 7.4 will register a parallel module.
- **Failure recovery UI** — admin view of failed webhooks; deferred.
- **Refund webhooks** (`charge.refunded`) — 7.5.
- **Stripe Connect events** (`account.updated`, payout transfers) —
  7.6.
- **Webhook replay tool** (CLI to re-fire a stored payload) —
  documented want, not needed v1.
- **`payment_intent.payment_failed` UX** — surfaces in Sentry; no
  tenant-facing message yet.

## 13. Acceptance criteria

- [x] `WebhookEvent` table + `WebhookEventStatus` enum migrate cleanly.
- [x] Raw body available on `req.rawBody` for every request without
      breaking the global Zod pipe.
- [x] `StripeService.constructEvent` verifies signatures and throws
      on mismatch.
- [x] `POST /v1/webhooks/stripe` returns 400 on bad signature, 503
      when secret unset, 200 on duplicate, 200 on dispatch.
- [x] `checkout.session.completed` flips a PENDING Stripe Payment
      row to SUCCEEDED and recomputes the Bill to PAID /
      PARTIALLY_PAID.
- [x] One `bill.payment.confirmed` audit row per confirmed payment;
      one `webhook.received` row per event.
- [x] `pnpm turbo typecheck lint test` clean.

## 14. Manual test plan

1. With `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` configured,
   start the API and run `stripe listen --forward-to
localhost:3001/v1/webhooks/stripe`.
2. Pay a bill via the tenant flow (7.2).
3. Watch `stripe listen` print `checkout.session.completed →
POST 200` within ~5s.
4. Confirm:
   - `WebhookEvent` row with `status: PROCESSED`.
   - `Payment` row flipped to `SUCCEEDED`.
   - `Bill` flipped to `PAID`.
   - Two audit rows: `webhook.received`, `bill.payment.confirmed`.
5. Refresh the tenant bill detail page → status shows `PAID`,
   payments list shows the Stripe row with `receivedAt` set.

## 15. Rollout

- One additive migration.
- Set `STRIPE_WEBHOOK_SECRET` in the deploy env; surface in the
  Stripe dashboard's Webhooks section.
- Comms: dev changelog — "Stripe webhook ack'd + bill state flips
  on real payment; VNPay IPN follows in 7.4."
