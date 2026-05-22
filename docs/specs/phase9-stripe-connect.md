# Spec: Stripe Connect partner onboarding (phase 9.1)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-22

## 1. Why

Phase 7.6 shipped admin payout disbursement but accepted only
`MANUAL_BANK_TRANSFER` — the admin enters a bank reference, money
moves out-of-band, the system records that it happened. The
`STRIPE_CONNECT` branch of `PayoutsService.markDisbursed` 501s with
`payouts.disbursement_method_unsupported` and a "needs onboarding"
detail. That's been the right call until now — paying out via Stripe
requires every partner to have completed their own Stripe onboarding
(KYC, bank account, ToS) and we had nowhere to start that flow.

Phase 9.1 wires Stripe Express ("Connect") onboarding into the
partner app. Once a partner is onboarded, the admin payout flow can
call `stripe.transfers.create` to push the partner cut directly to
their Stripe-held balance instead of moving funds by hand.

## 2. User stories

- As a **partner**, on my profile screen I see a "Connect with Stripe"
  button when I'm not yet onboarded. Clicking it redirects me to
  Stripe's hosted onboarding; when I'm done, Stripe redirects back
  and my profile shows a green "Active" badge.
- As an **admin**, when I disburse a partner's payout the
  `STRIPE_CONNECT` option becomes available for partners marked
  ACTIVE; the platform issues a real transfer + records the
  `tr_*` id in `disbursementRef`.
- As an **operator**, when Stripe revokes a partner (KYC fail, account
  closed) the `account.updated` webhook flips
  `PartnerProfile.stripeConnectStatus` to `RESTRICTED` and the next
  disbursement attempt 422s with a clear code.
- As a **developer**, when `STRIPE_SECRET_KEY` is unset, the
  onboarding endpoint 503s with `payments.provider_disabled` — same
  pattern as the 7.2 checkout endpoint.

## 3. Surfaces

| Surface             | App / file                                                     | Notes                                                                                        |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Schema              | `packages/db/prisma/schema.prisma`                             | `PartnerProfile.stripeConnectAccountId`, `stripeConnectStatus`, `stripeConnectOnboardedAt`   |
| Stripe SDK shim     | `apps/api/src/payments/stripe.client.ts` + `stripe.service.ts` | `createConnectAccount`, `createAccountLink`, `retrieveAccount`, `createTransfer`             |
| Onboarding endpoint | `apps/api/src/partners/partners.partner.controller.ts`         | `POST /v1/me/partner-profile/stripe-onboarding` → returns hosted URL                         |
| Webhook             | `apps/api/src/webhooks/webhooks.service.ts`                    | New `account.updated` branch; reconciles partner status                                      |
| Payouts             | `apps/api/src/payouts/payouts.service.ts`                      | `STRIPE_CONNECT` branch calls `createTransfer`; 422 when partner not ACTIVE                  |
| Shared schemas      | `packages/shared/src/schemas/partners.ts`                      | `stripeConnectStatusSchema`, response shape for onboarding URL                               |
| Partner UI          | `apps/partner/app/(authed)/profile/page.tsx`                   | "Connect with Stripe" button + status badge                                                  |
| Admin payouts UI    | `apps/admin/app/(authed)/payouts/page.tsx`                     | Disable STRIPE_CONNECT radio when partner status != ACTIVE; show status next to each partner |

## 4. Data model changes

```prisma
enum StripeConnectStatus {
  NOT_STARTED          // no `acct_*` created yet
  ONBOARDING           // account created; onboarding incomplete
  ACTIVE               // charges_enabled && payouts_enabled
  RESTRICTED           // Stripe revoked the account (KYC fail, etc.)
}

model PartnerProfile {
  // existing fields ...

  /// Stripe Express account id (`acct_*`). Set the first time a
  /// partner clicks "Connect with Stripe". Reused on subsequent
  /// onboarding sessions — partners can re-onboard a partially
  /// completed account.
  stripeConnectAccountId    String?  @unique @db.VarChar(60)

  /// Snapshot of Stripe's `charges_enabled && payouts_enabled`
  /// state. The `account.updated` webhook keeps this fresh.
  stripeConnectStatus       StripeConnectStatus @default(NOT_STARTED)

  /// First moment the account flipped to ACTIVE. Stays set even if
  /// the partner is later RESTRICTED — useful for tenure metrics.
  stripeConnectOnboardedAt  DateTime?
}
```

Migration: `stripe_connect`. Additive — three nullable columns + one
new enum.

## 5. Onboarding flow

```
1. Partner clicks "Connect with Stripe" on /profile.
2. Partner app POST /v1/me/partner-profile/stripe-onboarding.
3. API:
   a. If no stripeConnectAccountId → POST /accounts (type=express)
      with country/currency defaults; save accountId.
   b. POST /account_links with refresh_url + return_url back to
      the partner app's /profile page.
   c. 200 { url, expiresAt }.
4. Partner browser navigates to the Stripe-hosted URL.
5. Partner completes KYC, links bank account, accepts ToS.
6. Stripe redirects to return_url → partner sees /profile.
7. Stripe fires `account.updated` webhook in parallel.
8. WebhooksService updates stripeConnectStatus + onboardedAt based
   on `charges_enabled && payouts_enabled`.
9. Partner app polls /v1/me/partner-profile on /profile mount + after
   return; sees ACTIVE status, "Connect with Stripe" hides + badge
   shows.
```

Refresh path: if the partner abandons mid-flow, Stripe sends them to
`refresh_url` (same endpoint, idempotent — creates a new link for
the same accountId).

## 6. API shape

```ts
// packages/shared/src/schemas/partners.ts (additions)

export const StripeConnectStatus = {
  NOT_STARTED: 'NOT_STARTED',
  ONBOARDING: 'ONBOARDING',
  ACTIVE: 'ACTIVE',
  RESTRICTED: 'RESTRICTED',
} as const;
export type StripeConnectStatus = (typeof StripeConnectStatus)[keyof typeof StripeConnectStatus];
export const stripeConnectStatusSchema = z.nativeEnum(StripeConnectStatus);

export const startStripeOnboardingResponseSchema = z.object({
  url: z.string().url(),
  expiresAt: isoDateTimeSchema,
});
```

| Method | Path                                              | Roles   | Description                                                              |
| ------ | ------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| POST   | `/v1/me/partner-profile/stripe-onboarding`        | PARTNER | Returns a hosted onboarding URL valid for ~5 minutes.                    |
| GET    | `/v1/me/partner-profile` _(existing — augmented)_ | PARTNER | Response now carries `stripeConnectStatus` + `stripeConnectOnboardedAt`. |

The webhook surface picks up one new event type
(`account.updated`) — same controller and verification path as 7.3.

## 7. Disbursement changes

`PayoutsService.markDisbursed` `STRIPE_CONNECT` branch:

```ts
case 'STRIPE_CONNECT': {
  if (!this.stripe.isEnabled()) throw payouts.provider_disabled;
  const partner = await this.prisma.partnerProfile.findFirst({
    where: { user: { id: row.accountUserId } },
  });
  if (partner?.stripeConnectStatus !== 'ACTIVE') {
    throw new ProblemError({
      status: 422,
      type: ErrorCodes.PAYOUT_PARTNER_NOT_ONBOARDED,
      title: 'Partner has not completed Stripe onboarding',
    });
  }
  const transfer = await this.stripe.createTransfer({
    destination: partner.stripeConnectAccountId,
    amount: row.amount,
    currency: row.currency.toLowerCase(),
    metadata: { jobId: row.jobId, ledgerEntryId: row.id },
  });
  ref = transfer.id;
}
```

`input.reference` is ignored when the method is `STRIPE_CONNECT` (the
Stripe transfer id is the canonical reference); the existing audit

- notification + analytics paths run unchanged.

## 8. Permissions

- **Onboarding endpoint**: `@Roles('PARTNER')`. Self-only — uses
  `CurrentUser` to look up the calling partner's profile.
- **Webhook**: signature-verified, no role gate.
- **Disbursement**: unchanged, `@Roles('ADMIN')` on the admin
  controller.

## 9. Error codes (new)

- `payouts.partner_not_onboarded` — partner's status is not ACTIVE
  when admin tries STRIPE_CONNECT disbursement.
- `partners.stripe_onboarding_failed` — Stripe rejected
  account/account_link creation (rare; surfaces network errors).

## 10. Webhook handling

`account.updated` → `WebhooksService.onAccountUpdated`:

```
1. Verify signature (existing).
2. Insert WebhookEvent (provider: STRIPE, eventId).
3. Look up PartnerProfile by stripeConnectAccountId.
4. Compute status:
     - charges_enabled && payouts_enabled → ACTIVE
     - requirements.disabled_reason set → RESTRICTED
     - otherwise → ONBOARDING
5. On first ACTIVE: set stripeConnectOnboardedAt = now().
6. Audit row "partner.connect.status_changed" with from/to.
```

Idempotent via `(provider, eventId)` like every other Stripe event.

## 11. Edge cases

- **Partner clicks the link twice**: the second call creates a fresh
  account_link against the existing accountId. Cheap; the previous
  link's `expires_at` doesn't matter once a new one's issued.
- **Webhook arrives before the partner finishes**: status stays
  ONBOARDING; the partner sees the same UI; the next webhook closes
  the gap.
- **Partner deletes their bank account in Stripe**: `account.updated`
  fires with `payouts_enabled: false`. We flip to RESTRICTED. Future
  payouts 422 until they re-onboard.
- **Multiple partners share an email**: Stripe Express keys by
  email + manual confirmation; that's Stripe's problem. We key our
  rows by partnerProfileId.
- **Currency**: Stripe Express accounts are single-country/currency.
  v1 sets `country: 'VN'`, `default_currency: 'vnd'` at create time.
  Multi-currency support is a Phase 9 out-of-scope item — see
  BUILD_PLAN §Phase 9.

## 12. Out of scope

- **Express dashboard embeds** — partners see their balance via
  Stripe's hosted dashboard, not in our UI. Wiring `dashboard.create`
  is a follow-up.
- **Refunds / clawbacks** of partner payouts — Stripe Connect supports
  `transfers.createReversal`; we don't have a use case yet.
- **Standard / Custom Connect accounts** — Express is the only mode
  we ship; Standard requires partners to manage their own Stripe
  account, Custom requires us to do KYC ourselves.
- **Multi-currency partner payouts** — single VND-only stack in v1.
- **Tax form (1099 / equivalent) generation** — Stripe handles that
  for Express accounts automatically; nothing for us to wire.

## 13. Acceptance criteria

- [ ] `PartnerProfile` schema gains three new columns + the
      `StripeConnectStatus` enum; migration applies cleanly.
- [ ] `StripeService` exposes `createConnectAccount`,
      `createAccountLink`, `retrieveAccount`, `createTransfer`.
- [ ] `POST /v1/me/partner-profile/stripe-onboarding` returns a
      Stripe-hosted onboarding URL when the partner exists; 503 when
      Stripe is disabled; 401 when the caller isn't a partner.
- [ ] `account.updated` webhook flips `stripeConnectStatus` based on
      the canonical `charges_enabled && payouts_enabled` formula and
      writes an audit row.
- [ ] `PayoutsService.markDisbursed` `STRIPE_CONNECT` branch issues a
      real transfer when the partner is ACTIVE; 422
      `payouts.partner_not_onboarded` otherwise.
- [ ] Partner profile screen shows the onboarding CTA when
      `stripeConnectStatus !== 'ACTIVE'`; status badge otherwise.
- [ ] Service specs cover: onboarding endpoint happy path + idempotent
      re-call; webhook status-flip; markDisbursed gating.

## 14. Manual test plan

1. Set Stripe test-mode keys in `apps/api/.env`.
2. As a partner, click "Connect with Stripe", complete the test
   flow (test SSN `000-00-0000`, routing `110000000`, account
   `000123456789`).
3. Watch the webhook event in the Stripe CLI → the API → confirm
   `stripeConnectStatus: ACTIVE` on `/v1/me/partner-profile`.
4. As an admin, mark a RELEASED payout DISBURSED with
   `method: STRIPE_CONNECT` — verify the Stripe dashboard shows the
   transfer + the local `disbursementRef` matches `tr_*`.
5. Restrict the test account in Stripe (delete the bank); confirm
   the next webhook flips status to RESTRICTED + the next disbursement
   attempt 422s.

## 15. Rollout

- Forward-only migration. No backfill — every existing partner
  starts at `NOT_STARTED`.
- Vercel env: `STRIPE_SECRET_KEY` already exists for the 7.x flow;
  no new env vars required. The same webhook endpoint receives both
  payment events and `account.updated` — one Stripe webhook config
  serves all of it.
- Partners must individually opt in to Stripe Connect; no automatic
  migration of the MANUAL flow.
