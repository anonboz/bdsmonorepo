# Spec: VNPay integration (phase 7.4)

> Status: **implemented**
> Phase: 7
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

Stripe is the international payment rail; VNPay is the Vietnamese
one. The platform's tenants are mostly Vietnamese — most won't have
international cards, and VNPay supports domestic ATM cards, QR pay,
and a handful of bank apps that cover the long tail. BUILD_PLAN §8
flagged the VN-market provider as an open decision; 7.4 resolves
it: **VNPay first, MoMo as a follow-up if needed.**

The plumbing mirrors 7.2 + 7.3 — checkout endpoint + WebhookEvent

- signed handler — so the patterns stay consistent. Differences:
  VNPay is redirect + IPN (not a hosted Session model like Stripe),
  signs with HMAC-SHA512 over sorted query params, and only accepts
  VND.

## 2. User stories

- As a **tenant**, I want a "Pay with VNPay" button next to the
  Stripe one. Tapping it sends me to VNPay's hosted page where I
  can pay with a domestic ATM card, QR, or bank app.
- As a **tenant**, the bill flips to `PAID` within seconds of
  finishing — same UX as Stripe (the IPN does the actual work).
- As an **operator**, I see every IPN delivery in `WebhookEvent`
  with provider `VNPAY`, signed payload, processed status — the
  same shape as Stripe deliveries so the debugging path is one.

## 3. Surfaces

| Surface              | App / file                                 | Notes                              |
| -------------------- | ------------------------------------------ | ---------------------------------- |
| VNPay client helpers | `apps/api/src/payments/vnpay.client.ts`    | Pure: sign, build URL, verify IPN  |
| VNPay service        | `apps/api/src/payments/vnpay.service.ts`   | NestJS-DI facade for mockability   |
| Tenant checkout      | `POST /v1/me/bills/:billId/vnpay/checkout` | Returns redirect URL               |
| IPN handler          | `GET /v1/webhooks/vnpay/ipn`               | `@Public()`, signed, idempotent    |
| Browser return       | `/my-bills/[billId]/vnpay/return` (tenant) | "We're confirming…" — IPN is truth |
| Pay button           | `_components/pay-online.tsx` (extended)    | Adds a second button               |

## 4. Provider mechanics (cheat sheet)

VNPay's redirect flow:

```
[1] Tenant clicks Pay with VNPay
        ↓
[2] API POST /v1/me/bills/:id/vnpay/checkout
        → builds vnp_* params (incl HMAC-SHA512 over sorted query)
        → returns { url, paymentId }
        ↓
[3] Tenant browser → window.location = url
        → hosted page → tenant pays
        ↓
[4] VNPay server-to-server GET /v1/webhooks/vnpay/ipn?vnp_…
        ← we verify hash, flip Payment + Bill, respond { RspCode:'00', Message:'Confirm Success' }
        ↓
[5] VNPay redirects tenant browser to vnp_ReturnUrl
        → tenant lands on /my-bills/:id/vnpay/return
        → page polls / shows confirmation
```

Source of truth = step 4 (IPN). Step 5 (browser return) is
cosmetic only — never trust its query params for state changes.

### Required VNPay params (request URL)

| Param            | Value                                                   |
| ---------------- | ------------------------------------------------------- |
| `vnp_Version`    | `"2.1.0"`                                               |
| `vnp_Command`    | `"pay"`                                                 |
| `vnp_TmnCode`    | `env.VNPAY_TMN_CODE` (merchant code from VNPay)         |
| `vnp_Amount`     | `bill.total * 100` (VNPay multiplies by 100 internally) |
| `vnp_CurrCode`   | `"VND"` (only currency supported)                       |
| `vnp_TxnRef`     | `payment.id` (our local Payment row id; unique)         |
| `vnp_OrderInfo`  | human-readable, e.g. `Rent 2026-05`                     |
| `vnp_OrderType`  | `"billpayment"`                                         |
| `vnp_Locale`     | `"vn"` (override via env if needed)                     |
| `vnp_ReturnUrl`  | `${TENANT_APP_URL}/my-bills/${billId}/vnpay/return`     |
| `vnp_IpAddr`     | `req.ip`                                                |
| `vnp_CreateDate` | `YYYYMMDDHHMMSS` in `Asia/Ho_Chi_Minh` (GMT+7)          |
| `vnp_SecureHash` | HMAC-SHA512 of sorted query (added last; not in sign)   |

### Signature

```ts
const sorted = Object.keys(params)
  .filter((k) => params[k] !== '' && k !== 'vnp_SecureHash')
  .sort();
const data = sorted.map((k) => `${k}=${encodeURIComponent(params[k])}`).join('&');
const hash = createHmac('sha512', env.VNPAY_HASH_SECRET).update(data).digest('hex');
// Append vnp_SecureHash=<hash> to the URL (NOT to the signed string)
```

The same encoding (URL-encoded values) must be used both for signing
**and** for the URL we hand the browser. Mismatches there are the #1
source of "Invalid Signature" errors in VNPay integrations.

### IPN response codes (we send back)

| RspCode | When                                               |
| ------- | -------------------------------------------------- |
| `00`    | Confirm success — Payment updated, Bill recomputed |
| `01`    | `vnp_TxnRef` doesn't match a local Payment row     |
| `02`    | Payment already confirmed (`status === SUCCEEDED`) |
| `04`    | Amount doesn't match what we created               |
| `97`    | Signature invalid                                  |
| `99`    | Unknown error                                      |

Body: `{ "RspCode": "<code>", "Message": "<reason>" }`. VNPay stops
re-delivering once it sees any of these.

## 5. Env additions

| Var                 | Required | Default                                              | Notes                                              |
| ------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------- |
| `VNPAY_TMN_CODE`    | no       | unset                                                | Merchant code from VNPay dashboard                 |
| `VNPAY_HASH_SECRET` | no       | unset                                                | HMAC secret. Same secret used for signing + verify |
| `VNPAY_PAYMENT_URL` | no       | `https://sandbox.vnpayment.vn/paymentv2/vpcpay.html` | Sandbox by default; prod uses `pay.vnpay.vn`       |
| `VNPAY_LOCALE`      | no       | `"vn"`                                               | `"vn"` or `"en"` on the hosted page                |

Endpoint returns `503 payments.provider_disabled` when either
`VNPAY_TMN_CODE` or `VNPAY_HASH_SECRET` is unset.

## 6. Local Payment row

Same as Stripe: insert PENDING before returning the URL so the IPN
has a row to find.

```ts
const payment = await tx.payment.create({
  data: {
    billId,
    amount: outstanding,
    currency: 'VND',
    status: 'PENDING',
    provider: 'VNPAY',
    providerRef: null, // populated below
  },
});
const txnRef = payment.id; // use our cuid as vnp_TxnRef
await tx.payment.update({
  where: { id: payment.id },
  data: { providerRef: txnRef },
});
```

The `(provider, providerRef)` unique constraint guarantees one row
per `vnp_TxnRef`.

## 7. IPN handler

```ts
async handleVnpayIpn(query: Record<string, string>): Promise<VnpayIpnResponse> {
  if (!verifyHash(query, secret)) return { RspCode: '97', Message: 'Invalid Signature' };
  const txnRef = query.vnp_TxnRef;
  const eventId = `${txnRef}-${query.vnp_TransactionNo ?? 'pending'}-${query.vnp_ResponseCode}`;

  try {
    await prisma.webhookEvent.create({ … });
  } catch (P2002) {
    return { RspCode: '02', Message: 'Order already confirmed' };
  }

  const payment = await prisma.payment.findUnique({
    where: { provider_providerRef: { provider: 'VNPAY', providerRef: txnRef } },
  });
  if (!payment) return { RspCode: '01', Message: 'Order not found' };
  if (Number(query.vnp_Amount) !== payment.amount * 100) {
    return { RspCode: '04', Message: 'Invalid amount' };
  }
  if (payment.status === 'SUCCEEDED') {
    return { RspCode: '02', Message: 'Order already confirmed' };
  }

  if (query.vnp_ResponseCode === '00') {
    await this.applyVnpaySuccess(payment, query, eventId);  // same flip + audit as Stripe
  } else {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: `vnp ${query.vnp_ResponseCode}` } });
  }
  return { RspCode: '00', Message: 'Confirm Success' };
}
```

The handler shares the bill-recompute helper with the Stripe path.

## 8. WebhookEvent integration

Each IPN delivery writes one `WebhookEvent` row:

- `provider: 'VNPAY'`
- `eventId: <txnRef>-<vnp_TransactionNo>-<responseCode>`
- `type: 'vnpay.ipn.{success|failure}'`
- `payload`: the full query object

The `@@unique([provider, eventId])` constraint catches re-delivery —
VNPay re-fires until it sees a 2xx with `RspCode: '00'`, so
idempotency really matters here.

## 9. Audit

| Action                   | Target              | Meta                                                                                                 | Actor  |
| ------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| `bill.payment.confirmed` | `Payment:<id>`      | `billId`, `amount`, `currency`, `provider: VNPAY`, `eventId`, `billPreviousStatus`, `billNextStatus` | null   |
| `webhook.received`       | `WebhookEvent:<id>` | `provider: VNPAY`, `type`, `eventId`                                                                 | null   |
| `bill.checkout.start`    | `Payment:<id>`      | `billId`, `amount`, `currency`, `provider: VNPAY`, `txnRef`                                          | tenant |

`bill.payment.confirmed` is shared with Stripe — same downstream
reports / dashboards work without provider-specific paths.

## 10. UI

The Pay online card grows two buttons. Stripe stays primary
(international cards, faster onboarding for foreigners), VNPay is
secondary (domestic). Both disable themselves when the matching
provider's env vars are unset.

The browser return page (`/my-bills/[billId]/vnpay/return`) is the
same shape as Stripe's success page — "Confirming with VNPay…" plus
a back-to-bill link. The IPN updates the bill server-side; a
refresh shows PAID.

## 11. Edge cases

- **Currency mismatch** — bill in USD with VNPay attempt → 422
  `payments.currency_mismatch`. VNPay only supports VND.
- **`vnp_TxnRef` collision** — won't happen because we use the
  Payment row's cuid (collision probability ≈ 0). If it does, the
  unique constraint on `(provider, providerRef)` 500s the API and
  Sentry catches it.
- **IPN before the tenant's browser returns** — common and fine;
  the bill is already PAID by the time the return URL loads.
- **IPN never arrives** — VNPay retries with exponential backoff
  for ~24h. If still not delivered, the bill sits at `ISSUED`
  with a PENDING Payment row; owner can manually mark paid
  (Phase 7.1) or admin can be notified by a future stale-payment
  sweeper (deferred).
- **Browser-return signature** — VNPay's return URL params are
  also HMAC-signed. We _can_ verify them for defensive display
  state ("PAID" green vs "FAILED" red); the IPN is still the
  authority for DB state.
- **Replay** — same IPN twice → unique constraint on
  `WebhookEvent` short-circuits → respond with `RspCode: '02'`.

## 12. Out of scope

- **MoMo** — separate provider, separate slice if needed.
- **Refunds via VNPay** — 7.5. Has its own API surface.
- **QR-only flow** — same hosted page handles it.
- **Recurring payments** — VNPay doesn't really do this for v1.
- **VND amount validation against VNPay's min/max** — they enforce
  on the hosted page. If we fail their check, the tenant retries.
- **IP allowlist for IPN** — VNPay doesn't publish a stable IP
  range; signature verification is the only real gate.

## 13. Acceptance criteria

- [x] `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_PAYMENT_URL`,
      `VNPAY_LOCALE` declared in `env.ts`; all optional.
- [x] `vnpay.client.ts` exposes pure `buildPaymentUrl`,
      `verifyIpnSignature`, `formatVnpayDate` functions covered
      by their own spec.
- [x] `POST /v1/me/bills/:billId/vnpay/checkout` returns
      `{ url, paymentId }`. PENDING VNPAY Payment row created.
- [x] `GET /v1/webhooks/vnpay/ipn` verifies signature, updates
      Payment + Bill on `vnp_ResponseCode === '00'`, returns the
      VNPay-shaped JSON `{ RspCode, Message }`.
- [x] Currency mismatch → 422; missing env → 503; bad signature →
      `{ RspCode: '97' }`.
- [x] `bill.payment.confirmed` audit row matches the Stripe path's
      shape (downstream consumers don't branch on provider).
- [x] Tenant UI grows a second Pay button; disabled when VNPay env
      is unset.
- [x] `pnpm turbo typecheck lint test` clean.

## 14. Manual test plan

1. Acquire a VNPay sandbox merchant code + hash secret (the
   sandbox is free; see https://sandbox.vnpayment.vn/).
2. Set `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`,
   `VNPAY_PAYMENT_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html`.
3. Generate a bill (Phase 2.5).
4. Tap "Pay with VNPay" → lands on VNPay's sandbox page.
5. Use a test card (their docs publish a few) → completes.
6. Within a few seconds: bill flips PAID, a `WebhookEvent` row
   for the IPN is `PROCESSED`, Payment row is `SUCCEEDED`.
7. Refresh the tenant bill detail → status `PAID`, VNPay payment
   row visible with the `vnp_TransactionNo` in `providerRef` (or
   in `note` — implementation detail).

## 15. Rollout

- No migration (uses existing `Payment`, `WebhookEvent`,
  `PaymentProvider.VNPAY` enum).
- Set the VNPay env vars per environment via the secrets manager
  (`docs/operations/secrets-rotation.md` gets a new entry).
- VNPay's dashboard requires the IPN URL on file — set
  `https://api.<domain>/v1/webhooks/vnpay/ipn`.
- Comms: dev changelog — "VNPay live for VN-market tenants;
  refunds (7.5) come next."
