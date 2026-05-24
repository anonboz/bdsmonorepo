# Spec: MoMo payment provider (phase 12.1)

> Status: **drafting**
> Phase: 12
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 7.4 shipped VNPay as the VN-market rail; BUILD_PLAN §8 marked
MoMo as the follow-up. MoMo is the dominant VN e-wallet (~30M MAU,
skews younger than VNPay's bank-card audience), so tenants who don't
use a domestic ATM card still get a one-tap payment path. Closes the
last open VN-payments decision before the public launch.

The plumbing mirrors 7.4 — checkout endpoint + WebhookEvent-signed
IPN — so the patterns stay consistent. Differences vs VNPay:

- **POST/JSON** request to MoMo's `/v2/gateway/api/create` (VNPay
  builds a signed URL client-side); MoMo replies with a `payUrl` we
  redirect to.
- **HMAC-SHA256** (VNPay uses SHA-512), hex digest.
- **IPN is POST/JSON** with `204 No Content` ack (VNPay uses GET +
  `{ RspCode, Message }` body).
- No refund in v1 — MoMo refund is a separate API surface (see §9).

## 2. User stories

- As a **tenant**, I want a "Pay with MoMo" button next to Stripe +
  VNPay. Tapping it sends me to MoMo's hosted page where I can pay
  with the MoMo wallet, scan a QR, or open the MoMo app via deep
  link.
- As a **tenant**, the bill flips to `PAID` within seconds of
  finishing — same UX as Stripe / VNPay (the IPN does the work).
- As an **operator**, every MoMo IPN delivery lands in
  `WebhookEvent` with provider `MOMO`, signed payload, processed
  status — same debugging path as the other rails.

## 3. Surfaces

| Surface              | App / file                                                              | Notes                                                                            |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| MoMo client helpers  | `apps/api/src/payments/momo.client.ts`                                  | Pure: sign request, verify IPN, POST to MoMo API.                                |
| MoMo service         | `apps/api/src/payments/momo.service.ts`                                 | NestJS-DI facade for mockability.                                                |
| Checkout integration | `apps/api/src/payments/payments.service.ts`                             | `createMomoCheckoutForTenant()` — mirrors VNPay; calls MoMo, returns `payUrl`.   |
| Tenant route         | `apps/api/src/payments/payments.tenant.controller.ts`                   | `POST /v1/me/bills/:billId/momo/checkout`.                                       |
| IPN webhook          | `apps/api/src/webhooks/webhooks.momo.controller.ts`                     | `POST /v1/webhooks/momo/ipn`. `@Public()`.                                       |
| IPN handler          | `apps/api/src/webhooks/webhooks.service.ts`                             | `handleMomoIpn()` — sig verify, idempotency, Payment+Bill transitions, dispatch. |
| Env                  | `apps/api/src/env.ts`                                                   | `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `MOMO_CREATE_URL`.    |
| Tenant UI            | `apps/tenant/app/(authed)/my-bills/[billId]/_components/pay-online.tsx` | Adds the MoMo button + disabled-state handling.                                  |
| Return page          | `apps/tenant/app/(authed)/my-bills/[billId]/momo/return/page.tsx`       | Mirrors `vnpay/return` — read-only "thanks / cancelled" screen.                  |
| i18n                 | `packages/i18n/src/messages/{en,vi}/tenant.json`                        | `tenant.bills.payOnline.payMomo` + return-screen copy.                           |
| Tests                | `apps/api/src/payments/momo.client.spec.ts`                             | Sign + verify + POST shape; mirrors `vnpay.client.spec.ts`.                      |

## 4. MoMo v2 API shape

### 4.1 Create payment (server → MoMo)

```
POST  https://test-payment.momo.vn/v2/gateway/api/create
      (prod: https://payment.momo.vn/v2/gateway/api/create)
Content-Type: application/json

{
  "partnerCode": "<MOMO_PARTNER_CODE>",
  "requestId":   "<cuid>",
  "amount":      <int VND>,
  "orderId":     "<Payment row id>",
  "orderInfo":   "Rent 2026-06-01 - 2026-06-30",
  "redirectUrl": "https://tenant.../my-bills/<billId>/momo/return",
  "ipnUrl":      "https://api.../v1/webhooks/momo/ipn",
  "requestType": "captureWallet",
  "extraData":   "",
  "lang":        "vi" | "en",
  "signature":   "<HMAC_SHA256 of canonical>"
}
```

Canonical string for `signature`:

```
accessKey=$accessKey&amount=$amount&extraData=$extraData&ipnUrl=$ipnUrl&orderId=$orderId&orderInfo=$orderInfo&partnerCode=$partnerCode&redirectUrl=$redirectUrl&requestId=$requestId&requestType=$requestType
```

`HMAC_SHA256(secretKey, canonical).toString('hex')` — lowercase hex.

Response (success):

```json
{
  "partnerCode": "...",
  "requestId":   "...",
  "orderId":     "...",
  "amount":      <int>,
  "responseTime":<epoch ms>,
  "message":     "Successful.",
  "resultCode":  0,
  "payUrl":      "https://test-payment.momo.vn/pay/...",
  "deeplink":    "momo://...",
  "qrCodeUrl":   "..."
}
```

`resultCode === 0` means the URL is ready. We redirect the tenant to
`payUrl`. Non-zero → throw and surface a 502 to the tenant; they
retry.

### 4.2 IPN (MoMo → server)

```
POST  /v1/webhooks/momo/ipn
Content-Type: application/json

{
  "partnerCode":  "...",
  "orderId":      "<Payment row id>",
  "requestId":    "...",
  "amount":       <int>,
  "orderInfo":    "...",
  "orderType":    "momo_wallet",
  "transId":      <int — MoMo's bank-side transaction id>,
  "resultCode":   0,
  "message":      "Successful.",
  "payType":      "qr" | "webApp" | ...,
  "responseTime": <epoch ms>,
  "extraData":    "",
  "signature":    "<HMAC_SHA256 of canonical>"
}
```

Canonical string for IPN signature verification (alphabetized fields,
in this exact order — burned into MoMo's docs):

```
accessKey=$accessKey&amount=$amount&extraData=$extraData&message=$message&orderId=$orderId&orderInfo=$orderInfo&orderType=$orderType&partnerCode=$partnerCode&payType=$payType&requestId=$requestId&responseTime=$responseTime&resultCode=$resultCode&transId=$transId
```

Response: `204 No Content` on success. Any non-2xx triggers MoMo
retries (up to 5x over ~20 minutes).

`resultCode === 0` → success; any non-zero → MoMo treated the payment
as failed. We mark the Payment `FAILED` with
`failureReason=momo.resultCode=$resultCode`.

## 5. Idempotency

- Local idempotency: `WebhookEvent` unique constraint on `(provider,
eventId)` where `eventId = ${orderId}-${transId}-${resultCode}`.
  Duplicate POSTs return 204 immediately after the first PROCESSED.
- Payment-level idempotency: if `Payment.status === 'SUCCEEDED'` we
  short-circuit (same behavior as VNPay).
- Amount tampering: reject when `body.amount !== payment.amount` —
  same defensive check as VNPay (`vnp_Amount !== payment.amount * 100`,
  but MoMo doesn't multiply, so a direct compare).

## 6. Bill state transitions

Identical to VNPay (one canonical rule across all rails):

1. Find `Payment` by `(provider='MOMO', providerRef=orderId)`.
2. If missing → drop with a warn log (orphan IPN, e.g. test deliveries).
3. If `Payment.amount !== body.amount` → 4xx, no state change.
4. If `Payment.status === 'SUCCEEDED'` → 204, no-op.
5. On `resultCode !== 0` → `Payment.status = 'FAILED'` +
   `failureReason`; bill untouched.
6. On `resultCode === 0`:
   - `Payment.status = 'SUCCEEDED'`, `receivedAt = now()`,
     `providerCaptureRef = String(transId)`.
   - Recompute bill `SUM(SUCCEEDED.amount)`:
     - `>= bill.total` → `bill.status = 'PAID'` + dispatch
       `BILL_PAID` notification.
     - `< bill.total` → `bill.status = 'PARTIALLY_PAID'`, no dispatch.
7. AuditLog `bill.payment.confirmed` with `provider: 'MOMO'`.

## 7. Env vars

| Var                 | Required     | Default                                              |
| ------------------- | ------------ | ---------------------------------------------------- |
| `MOMO_PARTNER_CODE` | for live use | (unset)                                              |
| `MOMO_ACCESS_KEY`   | for live use | (unset)                                              |
| `MOMO_SECRET_KEY`   | for live use | (unset)                                              |
| `MOMO_CREATE_URL`   | optional     | `https://test-payment.momo.vn/v2/gateway/api/create` |

`MomoService.isEnabled()` is `Boolean(partnerCode && accessKey &&
secretKey)`. When false, the checkout endpoint returns 503
`payments.provider_disabled` (same code Stripe + VNPay use).

## 8. Tenant UI

The existing `pay-online.tsx` carries one button per enabled
provider. The `Provider` union grows from `'stripe' | 'vnpay'` to
`'stripe' | 'vnpay' | 'momo'`. The `disabled` map gains a `momo`
key; the "neither" empty-state widens to "none of the three"
(rename to `noneEnabled`).

New i18n keys under `tenant.bills.payOnline`:

- `payMomo` — "Pay with MoMo" / "Thanh toán với MoMo".
- `momoDisabledNote` — appended to the redirect-note when MoMo is the
  only disabled provider; mirrors `stripeDisabledNote` /
  `vnpayDisabledNote`.

New return page (`/my-bills/[billId]/momo/return`) under
`apps/tenant/app/(authed)/`:

- Reads `?resultCode=...&orderId=...&message=...` from MoMo's
  browser redirect.
- Renders one of:
  - `resultCode === '0'` → "Thanks for your payment" + back-to-bill link.
  - any other → "Payment did not complete" + back-to-bill link.
- **Does not mutate DB state.** The IPN is the source of truth (same
  contract as VNPay's `/vnpay/return`).

New i18n keys under `tenant.bills.momoReturn` (mirroring
`vnpayReturn`): `metadataTitle`, `okTitle`, `failTitle`,
`okDescription`, `failDescription`, `momoReferenceLabel`,
`ourReferenceLabel`, `stillOutstanding`, `backToBill`, `allBills`.

## 9. Out of scope

- **Refunds.** MoMo's refund API (`/v2/gateway/api/refund`) is a
  separate signed call with its own canonical string + a partial
  refund flag. Out of scope for 12.1 to keep the slice small;
  operators process MoMo refunds through the MoMo dashboard, then
  record a `MANUAL` refund on the bill (same workaround that 7.4
  used for VNPay refunds before 9.2 picked them up).
- **Deeplink + QR-only flows.** We only consume `payUrl`. The MoMo
  response also returns `deeplink` (`momo://...`) and `qrCodeUrl`;
  a future slice could render a QR on the bill detail page for
  in-person scanning, but the redirect flow covers the dominant
  desktop + mobile-browser cases first.
- **MoMo app status polling.** No `/query` call; we trust the IPN.
- **Notification template provider-aware copy.** The
  `BILL_PAID.data.provider` field already accepts any string; the
  existing template renders "via {provider}" so MoMo lands as
  "via MOMO" automatically.

## 10. Edge cases

- **MoMo create returns non-zero `resultCode`** (e.g. partner code
  unrecognised in prod): we mark the Payment `CANCELLED` (it never
  got a URL) and throw a 502 to the tenant. Their UI surfaces the
  error and lets them retry.
- **IPN arrives before the tenant lands on the return page.** Fine —
  the return page just renders status text from the redirect query;
  it doesn't read the DB. If the tenant refreshes the bill page they
  see PAID. (Same as VNPay.)
- **`resultCode === 0` but `amount` mismatches the Payment row.**
  Reject the IPN (return 4xx). MoMo will retry; ops investigates.
  This is a defensive guard against a tampered payload (signature
  caught it first, but we double-check).
- **Test deliveries against an unknown order id.** We drop with a
  warn log and return 204 (don't make MoMo retry forever).
- **`extraData` field.** We always send empty string; MoMo's
  canonical string treats empty `extraData=` correctly. If a future
  slice adds an opaque tag (e.g. tenantId for analytics), the
  canonical-string builder must include it.

## 11. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean.
- [ ] Tenant on `/my-bills/<id>` sees three payment buttons (Stripe,
      VNPay, MoMo) when all are configured; only the configured ones
      when not.
- [ ] `POST /v1/me/bills/:id/momo/checkout` returns `{ url, sessionId,
paymentId }` with `url` starting with `https://...momo.vn/pay/`.
- [ ] A signed IPN with `resultCode=0` and matching amount flips the
      Payment to `SUCCEEDED` and the Bill to `PAID`; a duplicate IPN
      returns 204 without mutating state.
- [ ] An IPN with a bad signature returns 401 and does NOT write a
      WebhookEvent row.
- [ ] An IPN with a known orderId but mismatched amount returns 4xx
      and does NOT mutate the Payment row.
- [ ] Tenant return page reads the redirect query and renders the
      correct status string in vi + en.

## 12. Manual test plan

1. Apply MoMo sandbox credentials to `.env.local` (`MOMO_PARTNER_CODE`,
   `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`). Sandbox values are public
   on MoMo's developer portal.
2. Set the IPN URL via a tunnel (`ngrok http 3001`); update
   `API_PUBLIC_URL` for the create call to use the public host so
   MoMo can call us back.
3. From tenant, click "Pay with MoMo" on an ISSUED bill. Browser
   lands on the MoMo sandbox page.
4. Complete a sandbox payment (use test card `9704 0000 0000 0018` /
   OTP `OTP`). Tenant returns to the `/momo/return` page, sees
   "Thanks for your payment".
5. Within ~5s the bill detail page shows `PAID` (IPN landed).
6. Inspect `WebhookEvent` table — one row with `provider='MOMO'`,
   `status='PROCESSED'`.
7. Re-trigger the IPN from the MoMo dashboard; observe the duplicate
   ack (still PROCESSED, no state change).

## 13. Rollout

- No DB migration. `PaymentProvider` already includes `MOMO` (added
  in schema seed). Existing `Payment.provider_providerRef` unique
  index covers MoMo with no changes.
- Env vars default to MoMo's sandbox `MOMO_CREATE_URL`; production
  must set the three credentials + override the URL to
  `https://payment.momo.vn/v2/gateway/api/create`.
- No feature flag. The tenant button only appears when the env vars
  are set; absent vars surface 503 `payments.provider_disabled`
  which the UI catches + hides the button.
