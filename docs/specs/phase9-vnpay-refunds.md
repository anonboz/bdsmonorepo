# Spec: VNPay refunds (phase 9.2)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-22

## 1. Why

Phase 7.5 shipped the refund flow but 501'd the `VNPAY` provider
branch:

> Process the refund via the VNPay dashboard, then record a MANUAL
> refund here so the bill stays in sync.

That detour is fine for the VN-market launch but adds an out-of-band
step for every refund. VNPay does support API refunds — `vnp_Command:
'refund'` against the `merchant_webapi` endpoint, HMAC-SHA512 signed
the same way as the existing checkout URL + IPN handler.

Phase 9.2 wires that flow. After this slice, the owner's refund flow
on a VNPay payment is exactly the same as Stripe: one click, the
provider confirms synchronously, the local ledger row lands, the
bill recomputes.

## 2. User stories

- As an **owner** with a VNPay-paid bill, I click "Refund" and the
  refund completes in one request — no VNPay dashboard step.
- As a **tenant**, my refund lands within the same VNPay flow the
  original payment used; no out-of-band money transfer to track.
- As an **operator**, when VNPay rejects (already refunded, wrong
  signature, expired transaction), the local ledger row is **not**
  created and the bill stays in `PAID` — no half-applied state.
- As a **developer**, when VNPay env vars are unset the refund call
  503s with `payments.provider_disabled`, same shape as the rest of
  the provider gates.

## 3. Surfaces

| Surface          | App / file                                  | Notes                                                                                                                          |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Schema           | `packages/db/prisma/schema.prisma`          | `Payment.providerCaptureDate DateTime?` — captures the original vnp_PayDate so refunds can echo it back.                       |
| Webhook          | `apps/api/src/webhooks/webhooks.service.ts` | `applyVnpayIpn` persists `vnp_PayDate` into the new column when the IPN succeeds.                                              |
| VNPay client     | `apps/api/src/payments/vnpay.client.ts`     | New `buildRefundBody`, `postRefund` (signed POST against `VNPAY_REFUND_URL`).                                                  |
| VNPay service    | `apps/api/src/payments/vnpay.service.ts`    | `createRefund(...)` wraps the client; returns provider response code + transactionNo.                                          |
| Payments service | `apps/api/src/payments/payments.service.ts` | Replaces the 501 `VNPAY` branch with a real refund call. Same flow shape as Stripe.                                            |
| Env              | `apps/api/src/env.ts`                       | New `VNPAY_REFUND_URL` (defaults to sandbox merchant_webapi).                                                                  |
| Error codes      | `packages/shared/src/errors/codes.ts`       | New `PAYMENT_REFUND_PROVIDER_FAILED` (the existing `PAYMENT_REFUND_MISSING_CAPTURE_REF` covers the no-vnp_TransactionNo case). |

No UI changes — the owner's existing refund button on the bill
detail screen already POSTs to the refund endpoint; only the
behavior behind it changes.

## 4. Data model changes

```prisma
model Payment {
  // existing fields ...

  /// Original provider-side transaction timestamp. For VNPay this is
  /// the IPN's `vnp_PayDate` lifted to a `Date`; required to echo
  /// back on refund (VNPay's `vnp_TransactionDate` parameter).
  /// NULL for pre-9.2 captures and MANUAL / Stripe payments
  /// (Stripe refunds via PaymentIntent don't need the date).
  providerCaptureDate DateTime?
}
```

Migration: `payment_capture_date`. Additive — one nullable column. No
backfill — every existing VNPay row stays NULL, the refund flow 422s
on those with a specific code so the owner can fall back to the
MANUAL flow.

## 5. VNPay refund API

VNPay's refund endpoint is documented as:

```
POST https://sandbox.vnpayment.vn/merchant_webapi/api/transaction
Content-Type: application/json

{
  "vnp_RequestId": "<unique-request-id>",
  "vnp_Version": "2.1.0",
  "vnp_Command": "refund",
  "vnp_TmnCode": "<your-tmn-code>",
  "vnp_TransactionType": "02",        // 02 = full, 03 = partial
  "vnp_TxnRef": "<our-local-payment-id>",
  "vnp_Amount": <amount * 100>,
  "vnp_OrderInfo": "Refund reason",
  "vnp_TransactionNo": "<vnp-transaction-no>",
  "vnp_TransactionDate": "<yyyyMMddHHmmss>",
  "vnp_CreateBy": "<actor>",
  "vnp_CreateDate": "<yyyyMMddHHmmss>",
  "vnp_IpAddr": "<server-ip>",
  "vnp_SecureHash": "<hmac-sha512 over canonical signed fields>"
}
```

The signature canonical string is the `vnp_*` field values
concatenated with `|`, in this exact order:

```
vnp_RequestId | vnp_Version | vnp_Command | vnp_TmnCode |
vnp_TransactionType | vnp_TxnRef | vnp_Amount | vnp_TransactionNo |
vnp_TransactionDate | vnp_CreateBy | vnp_CreateDate | vnp_IpAddr |
vnp_OrderInfo
```

(per the VNPay 2.1 refund docs — note this is **not** the URL-encoded
sort-and-concat scheme the checkout URL uses; refunds are a separate
signing format).

## 6. Response handling

```json
{
  "vnp_ResponseId": "...",
  "vnp_Command": "refund",
  "vnp_ResponseCode": "00",          // 00 = success; everything else = fail
  "vnp_Message": "...",
  "vnp_TmnCode": "...",
  "vnp_TxnRef": "...",
  "vnp_Amount": <amount * 100>,
  "vnp_OrderInfo": "...",
  "vnp_BankCode": "...",
  "vnp_PayDate": "<yyyyMMddHHmmss>",
  "vnp_TransactionNo": "<new-refund-transaction-no>",
  "vnp_TransactionType": "02",
  "vnp_TransactionStatus": "00",
  "vnp_SecureHash": "<...>"
}
```

We persist `vnp_TransactionNo` (the **refund** transaction number) as
`providerRef` on the new refund Payment row. On non-`00` response,
throw `PAYMENT_REFUND_PROVIDER_FAILED` with the `vnp_Message` as
detail; no local row is created.

## 7. Refund flow (post-9.2)

```
1. Owner POSTs /v1/me/houses/.../bills/<billId>/payments/<paymentId>/refund.
2. PaymentsService:
   a. Loads original payment; gate on SUCCEEDED + positive amount.
   b. If provider = VNPAY:
        - 422 if no providerCaptureRef.
        - 422 if no providerCaptureDate (pre-9.2 capture).
        - POST to VNPay refund endpoint, signed.
        - 422 PAYMENT_REFUND_PROVIDER_FAILED on non-`00` response.
        - Otherwise capture refund transaction no as providerRefundRef.
   c. Same $transaction as Stripe — Payment refund row + bill recompute
      + audit + notification + analytics.
```

## 8. Permissions

Unchanged from 7.5 — owner of the lease only. Cross-party access 404s.

## 9. Edge cases

- **Pre-9.2 capture without `providerCaptureDate`**: refund 422s with
  `payments.refund_missing_capture_ref` (reuses the existing code —
  the message detail explains "this VNPay payment landed before
  Phase 9.2; refund via the VNPay dashboard, then record a MANUAL
  refund here").
- **Partial refund**: VNPay supports it (`vnp_TransactionType: '03'`).
  We send `'02'` when amount equals the original; `'03'` otherwise.
- **Duplicate refund request**: VNPay rejects with a non-`00` code;
  we surface it as `PAYMENT_REFUND_PROVIDER_FAILED`. No local row
  written.
- **VNPay outage**: fetch throws; bubbles up to the controller's
  error filter (no Problem code → defaults to 500 + a Sentry tag).
  Owner retries; idempotent because no local state changed.
- **Refund response signature mismatch**: we accept any signed body
  but check `vnp_ResponseCode === '00'`. v1 doesn't re-verify the
  signature on the response — the connection is HTTPS-pinned and
  the response code is the source of truth per VNPay's docs.

## 10. Acceptance criteria

- [ ] `Payment.providerCaptureDate` added; migration applies cleanly.
- [ ] VNPay IPN handler populates `providerCaptureDate` from
      `vnp_PayDate` on the success path.
- [ ] `VnpayService.createRefund` posts to the configured endpoint
      with a correctly signed body (canonical-pipe-separated format).
- [ ] `PaymentsService.refundForOwner` `VNPAY` branch replaces the
      501 with the new flow; 422 on missing capture ref or capture
      date; 422 `payments.refund_provider_failed` on non-`00`.
- [ ] Unit specs cover: signature canonical-string construction,
      `createRefund` happy path, `refundForOwner` VNPAY success +
      VNPay-rejection + missing-capture-date cases.

## 11. Manual test plan

1. Set VNPay sandbox keys + `VNPAY_REFUND_URL` in `apps/api/.env`.
2. Pay a bill via the existing VNPay flow.
3. From the owner app, click "Refund" on the bill detail screen.
4. Watch the VNPay sandbox dashboard show the refund.
5. Confirm the bill's status flipped to `ISSUED` and a negative
   Payment row landed with `provider: 'VNPAY'`,
   `providerRef: tr_<refundTxNo>`, `refundOfPaymentId: <original>`.
6. Repeat with a partial refund; confirm bill goes to
   `PARTIALLY_PAID` and `vnp_TransactionType` was `'03'`.

## 12. Out of scope

- **Refund response signature re-verification** — VNPay's docs
  don't require it; the HTTPS channel + `vnp_ResponseCode` is what
  we trust. Add later if abuse patterns emerge.
- **MoMo refunds** — still 501. MoMo's refund API uses a different
  envelope and lands when the MoMo checkout path does.
- **Refund retries on transient failure** — owner retries
  manually for v1. A BullMQ retry queue is a follow-up.

## 13. Rollout

- Forward-only migration: one nullable column.
- Vercel env: add `VNPAY_REFUND_URL`
  (defaults to `https://sandbox.vnpayment.vn/merchant_webapi/api/transaction`).
- Existing VNPay captures without `providerCaptureDate` cannot use
  the new API path; owners can still record a MANUAL refund. Note
  in the runbook (9.7).
