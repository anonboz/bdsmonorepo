# Spec: PostHog analytics (phase 8.7)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-22

## 1. Why

`apps/api/src/env.ts` has reserved `POSTHOG_KEY` since Phase 6 with
nothing reading it. We need product analytics to answer two questions:

1. **Onboarding → first payment funnel.** Where do users fall off
   between "I logged in for the first time" and "I paid my first
   bill / a partner paid me out"? Owner conversion is the metric
   that decides every roadmap argument.
2. **Per-role engagement.** Do tenants come back daily, weekly,
   never? Do partners read incoming jobs before quoting? These shape
   notification design, not just UX work.

PostHog (cloud or self-hosted) covers both via a typed event bus with
funnels, retention, and path-analysis built in. The wiring is two
tiny SDK calls in code: `posthog-js` on the four PWAs + `posthog-node`
in the API for events that don't have a browser session attached
(webhook-driven bill confirmations, partner payouts).

## 2. User stories

- As a **PM**, I open PostHog and see today's signup → first-bill-paid
  conversion rate as a funnel without writing any SQL.
- As an **engineer**, when I add a state transition that should
  show up in analytics, I add one `analytics.capture(...)` call —
  no Kafka topic, no schema review.
- As **legal**, when a user is deleted we issue a single
  `posthog.optOut + delete`-equivalent through PostHog's GDPR
  endpoint; no PII left in our analytics column.
- As a **developer running locally**, when `POSTHOG_KEY` is unset
  (the default), every call is a no-op. No "PostHog initialized"
  console noise, no network calls.

## 3. Event taxonomy (v1)

Events are `domain.action`, lowercase, dot-separated. Mirrors the
audit-log action names where they overlap. Every event carries a
`role` property so a PostHog filter on `properties.role = 'TENANT'`
slices any aggregate.

| Event            | Sent by | When                                                | Key props                                                 |
| ---------------- | ------- | --------------------------------------------------- | --------------------------------------------------------- |
| `user.signed_in` | PWA     | After `(authed)` layout mounts post-redirect        | `role` (single property; no PII)                          |
| `bill.paid`      | API     | Bill status flips to PAID — manual / Stripe / VNPay | `role: TENANT`, `amount`, `currency`, `provider`          |
| `bill.refunded`  | API     | `PaymentsService.refundForOwner` succeeds           | `role: TENANT`, `amount`, `currency`, `provider`          |
| `job.completed`  | API     | `ServiceJobsService.completeForPartner` succeeds    | `role: PARTNER`, `final_amount`, `currency`, `commission` |
| `inbox.opened`   | PWA     | User visits `/notifications`                        | `role`                                                    |

A `user.signed_up` capture (called from a better-auth `databaseHooks.user.create.after`
hook) is the natural funnel entry point and lands in a follow-up — it
needs the auth surface to grow a post-signup hook + a small
identification dance that's out of scope for 8.7. The funnel works
with `user.signed_in` as a v1 proxy: the first sign-in row per
distinct_id is effectively the first session.

User identity: PostHog's `distinct_id` = our `User.id`. Server-side
`identify` is called inside the same handler that captures the
event so the event lands with the right person attached. Client-side
`identify` runs after the session bootstrap.

No event captures email, phone, name, or message body content.
Money amounts are integer minor units + currency — same as everywhere
else in the system.

## 4. Onboarding → first-payment funnel

Defined in PostHog's UI (not in code) as:

```
1. user.signed_up     (within last 30 days)
2. user.signed_in     (any time after step 1)
3. bill.paid          (within 90 days of step 1, role: TENANT)
```

The funnel is per-role; the owner equivalent runs on
`bill.paid + role: TENANT + bill.lease.ownerId = me` — actually the
owner side is "first bill issued" → "first bill paid" which we
already cover via the existing `bill.paid` event. Owner funnel polish
is a PostHog dashboard task, not a code change.

## 5. Surfaces

| Surface            | App / file                                                                                                                 | Notes                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Server SDK         | `apps/api/src/common/analytics/`                                                                                           | `AnalyticsService` wraps `posthog-node`. `@Global()` module, like Storage / Mailer.                        |
| Server captures    | `BillsService`, `PaymentsService`, `WebhooksService`, `ServiceJobsService`, `AuthService`                                  | One `analytics.capture(...)` call per state-transition site, sitting next to the existing audit-log write. |
| Browser SDK        | `apps/{admin,owner,tenant,partner}/lib/analytics.ts`                                                                       | Per-app `posthog-js` init using `NEXT_PUBLIC_POSTHOG_KEY`. Thin wrapper.                                   |
| Shared init helper | `@repo/config/analytics`                                                                                                   | `buildClientOptions({ role, dsn })` + identify helper. Same pattern as `@repo/config/sentry`.              |
| Provider component | Per-app `(authed)/_components/analytics-provider.tsx`                                                                      | Client component mounted in the `(authed)` layout that calls identify + page-view capture.                 |
| Env additions      | API: `POSTHOG_HOST` (defaults to `https://us.i.posthog.com`); PWAs: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`. | Existing `POSTHOG_KEY` env var becomes the server-side key.                                                |

## 6. Server-side shape

```ts
// apps/api/src/common/analytics/analytics.service.ts

export interface CaptureInput {
  /** The User.id of the actor. Required — analytics without a user
   *  attached is mostly noise. */
  userId: string;
  event: string;
  properties?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  /** Cheap no-op when POSTHOG_KEY is unset. */
  capture(input: CaptureInput): void;

  /** Identify a user with their role. Called from sign-in. */
  identify(userId: string, props: { role: Role | Role[] }): void;

  /** Called on app shutdown to flush the buffered queue. */
  onModuleDestroy(): Promise<void>;
}
```

`posthog-node` ships a `PostHog` class that batches events client-side

- flushes on a timer. Cheap to construct; we hold one instance per
  process.

## 7. Browser-side shape

```ts
// packages/config/analytics/index.ts

export interface AnalyticsAppContext {
  appRole: 'admin' | 'owner' | 'tenant' | 'partner';
  apiKey: string | undefined; // NEXT_PUBLIC_POSTHOG_KEY
  apiHost?: string; // NEXT_PUBLIC_POSTHOG_HOST
}

export function buildPostHogOptions(ctx: AnalyticsAppContext): {
  api_host: string;
  capture_pageview: boolean;
  persistence: 'localStorage+cookie';
  property_blacklist: string[];
  loaded: (ph: { register: (p: Record<string, unknown>) => void }) => void;
};
```

The per-app `analytics-provider.tsx` is a Client Component that:

- Imports `posthog-js` dynamically (Next 15 SSR friendly).
- Calls `posthog.init(key, buildPostHogOptions(...))` once on mount.
- Calls `posthog.identify(userId, { role })` from the session.
- Captures `user.signed_in` once per mount.

Unset `NEXT_PUBLIC_POSTHOG_KEY` → the init is skipped + the provider
renders nothing.

## 8. Privacy + GDPR

- `property_blacklist` strips `$ip`, `$initial_referrer`, `$initial_referring_domain`,
  and `email` from autocaptured events.
- `mask_all_text: true` is **off** — we don't run Session Replay in
  v1 anyway. If we add Replay later, flip it on.
- Identity: `distinct_id = User.id`. No email / phone / name.
- User deletion: a GDPR-erasure script runs `posthog.deleteUser(id)`
  via PostHog's GDPR API. That code path lands with the rest of
  the erasure work, not in 8.7.
- The server SDK reads `POSTHOG_KEY` (server-only). The client SDK
  reads `NEXT_PUBLIC_POSTHOG_KEY` — different env var, different
  PostHog project (one for server, one for client) so a leaked
  client key can't be used to read server-only event streams.

## 9. Out of scope

- **Session Replay** (PostHog feature) — enabled by a future env flag
  if support actually needs to see what the user did.
- **Cohorts / experiments** — defined in PostHog's UI, not in code.
- **A/B test feature flags** — `posthog-js` supports them but we have
  no v1 use case.
- **Real-time PostHog → Slack alerting** — handled in the PostHog
  workspace, not the API.

## 10. Acceptance criteria

- [ ] `posthog-node` listed as an API dep; `posthog-js` listed as
      a shared PWA dep at one pinned version.
- [ ] `apps/api/src/common/analytics/` module exists with the
      `AnalyticsService` from §6.
- [ ] `PaymentsService.recordManualForOwner` (PAID branch),
      `PaymentsService.refundForOwner`, `WebhooksService.onCheckoutSessionCompleted`
      (PAID branch), `WebhooksService.applyVnpayIpn` (PAID branch), and
      `ServiceJobsService.completeForPartner` all call `analytics.capture(...)`
      with the events in §3.
- [ ] Each PWA has an `analytics-provider.tsx` mounted in the
      `(authed)` layout.
- [ ] `@repo/config/analytics` exports the `buildPostHogOptions`
      helper.
- [ ] All event captures use integer minor-units + currency for money.
- [ ] Unit tests cover: AnalyticsService no-ops when `POSTHOG_KEY`
      is unset; capture passes through to the SDK with `role` set;
      `identify` includes the role array.
- [ ] `pnpm turbo typecheck` clean.
- [ ] `pnpm turbo lint` clean.
- [ ] 296+ API tests + new analytics specs all green.

## 11. Manual test plan

1. Set `POSTHOG_KEY` to a sandbox project key in `apps/api/.env`.
2. Set `NEXT_PUBLIC_POSTHOG_KEY` to a different (browser) project key
   in `apps/tenant/.env.local`.
3. `pnpm dev`, sign in as a tenant, pay a manual bill from the owner
   app, check the PostHog live-events stream — should see
   `bill.paid` with `role: TENANT, amount, currency, provider:
'MANUAL'`.
4. Repeat for a Stripe checkout completion (Stripe CLI → forward
   webhooks → confirm bill).
5. Verify the funnel `user.signed_up → user.signed_in → bill.paid`
   reports the same user via the `distinct_id`.

## 12. Rollout

- No DB migration.
- No feature flag — analytics is purely opt-in via env.
- Vercel deploy injects `NEXT_PUBLIC_POSTHOG_KEY`; Fly / Vercel API
  deploy injects `POSTHOG_KEY`. Unset = no analytics.
- No backfill: events start landing at deploy time.
