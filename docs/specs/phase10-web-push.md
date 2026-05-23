# Spec: Web push notifications (phase 10.5)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8 explicitly deferred web push as out-of-scope: the
`notifications.send` worker only fans out via email. Email is fine
for "your bill is ready" once a month but it's wrong for
time-sensitive transitions (a ticket reply, a partner accepting a
job, a payout disbursed) where the user is sitting in front of the
PWA. The bell-icon in-app row is the right surface for those, but
without a push notification the icon stays unread on the user's
phone until they next foreground the app.

Phase 10.5 closes the gap by:

- Letting each authenticated user register one or more browser
  push subscriptions (one per device / browser).
- Extending the `notifications.send` worker to fan out via web-push
  alongside email when the user has at least one active
  subscription and hasn't muted the push channel.
- Surfacing a single-click subscribe button in the tenant PWA as
  the canonical example. Owner / partner / admin PWAs get the same
  pattern in a follow-up 10.5b polish slice.

The "browser-managed only" guidance from the BUILD_PLAN stands:
no FCM/APNs server keys, no platform-specific IDs, no native
mobile app integration in v1.

## 2. User stories

- As a **tenant** sitting in the PWA on Chrome / Edge / Firefox, I
  click "Enable push" once and grant the browser permission. From
  then on, an event like `bill.issued` shows a system notification
  on my desktop / phone even if the tab is closed.
- As a **tenant** worried about noise, I can mute the push channel
  for a topic via the 10.4 per-scope preference (`scope: PUSH,
muted: true`) without affecting in-app or email.
- As a **user**, when I reset my browser or revoke permission, the
  next push attempt the API makes for my subscription receives a
  `410 Gone`; the server prunes the row automatically so I don't
  see "ghost" subscriptions in my settings.
- As an **ops on-call**, the `notifications.send` worker logs
  per-subscription success / failure / pruned counts so I can
  watch for misconfigured VAPID keys or a provider-side outage.
- As a **developer**, the dispatch flow doesn't change shape — a
  caller still calls `NotificationsService.dispatch(tx, …)` and the
  worker chooses channels. No per-caller branching.

## 3. Surfaces

| Surface        | App / file                                                                                                   | Notes                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Schema         | `packages/db/prisma/schema.prisma`                                                                           | New `PushSubscription` model + `NotificationPreferenceScope.PUSH` enum value.                                  |
| Shared types   | `packages/shared/src/schemas/push.ts` (new)                                                                  | `pushSubscriptionSchema`, `createPushSubscriptionSchema`, list response.                                       |
| Service        | `apps/api/src/notifications/push-subscriptions.service.ts`                                                   | CRUD over `PushSubscription`; called from the controller + the send worker.                                    |
| Controller     | `apps/api/src/notifications/notifications.controller.ts`                                                     | Add GET / POST / DELETE under `push-subscriptions`.                                                            |
| Worker         | `apps/api/src/notifications/notifications.worker.ts`                                                         | After the email branch, fan out via `web-push` to every active subscription. Prune on 410 / 404 / invalid sig. |
| Send templates | `apps/api/src/notifications/notifications.templates.ts`                                                      | Re-use existing renderer; add a thin `pushTitle / pushBody` projection per topic.                              |
| Env            | `apps/api/src/env.ts` + `scripts/validate-env.ts`                                                            | New optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.                                         |
| Deps           | `apps/api/package.json`                                                                                      | New direct dep `web-push`.                                                                                     |
| Tenant PWA     | `apps/tenant/lib/push.ts` (new) + `apps/tenant/app/(authed)/notifications/_components/push-toggle.tsx` (new) | Browser permission + subscribe round-trip; canonical button.                                                   |
| Tenant env     | `apps/tenant/.env.example`                                                                                   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` documented.                                                                     |
| Other PWAs     | (deferred to 10.5b)                                                                                          | Owner / partner / admin get the same wiring once we've validated tenant. Spec gates the per-app rollout.       |

The Serwist service worker in each PWA already receives the
`push` event (Workbox forwards it automatically when the worker
listens for it). v1 ships a minimal `self.addEventListener('push', …)`
handler in the tenant PWA only; the other PWAs continue to
register subscriptions in 10.5b once the tenant flow is validated.

## 4. API shape

```ts
// packages/shared/src/schemas/push.ts

/**
 * Browser PushSubscription as serialized by `subscription.toJSON()`.
 * The `keys` block carries the ECDH public key (`p256dh`) and the
 * 16-byte auth secret the browser issues; both base64url-encoded.
 */
export const createPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(800),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(60),
  }),
  /** Free-form label, e.g. "Chrome on Pixel 8". Optional. */
  userAgent: z.string().max(200).optional(),
});

export const pushSubscriptionSchema = z.object({
  id: idSchema,
  endpoint: z.string().url(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

export const listPushSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(pushSubscriptionSchema),
});
```

Endpoints (user-facing, all under `/v1/notifications/push-subscriptions`):

| Method | Path   | Role(s)                       | Description                                                                                           |
| ------ | ------ | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET    | `/`    | TENANT, OWNER, PARTNER, ADMIN | List the caller's active subscriptions.                                                               |
| POST   | `/`    | TENANT, OWNER, PARTNER, ADMIN | Upsert by `(userId, endpoint)`; re-subscribing the same browser overwrites the keys/userAgent fields. |
| DELETE | `/:id` | TENANT, OWNER, PARTNER, ADMIN | Removes the caller's subscription. 404 on cross-user id.                                              |

## 5. Data model changes

```prisma
model PushSubscription {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Browser-issued URL the push service POSTs to. Unique per
  /// browser+origin; we key uniqueness on (userId, endpoint).
  endpoint  String   @db.VarChar(800)

  /// ECDH public key + auth secret from `PushSubscription.toJSON()`.
  /// Stored as VARCHAR (already base64url); we never decode them
  /// server-side beyond passing through to `web-push.sendNotification`.
  p256dh    String   @db.VarChar(200)
  auth      String   @db.VarChar(60)

  /// Optional free-form label captured client-side (e.g. UA string)
  /// so the user can see which subscriptions are theirs in settings.
  userAgent String?  @db.VarChar(200)

  /// Set by the worker when a push attempt fails terminally
  /// (HTTP 404 / 410). The row is then deleted; the column is here
  /// for an audit-row meta in case we soft-delete instead later.
  failedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, endpoint])
  @@index([userId])
}

enum NotificationPreferenceScope {
  ALL
  EMAIL
  IN_APP
  /// Phase 10.5 — mute the web-push fanout while keeping in-app /
  /// email behavior unchanged.
  PUSH
}
```

Migration name: `push_subscriptions`.

The new enum value is additive — existing rows with
`scope = ALL/EMAIL/IN_APP` keep their semantics. A `scope = PUSH,
muted = true` row suppresses only the push fanout.

## 6. Dispatch behavior

The dispatch gate (Phase 10.4) doesn't need to change for the
in-app + email decision. The new logic lives entirely in the
**send worker**, which already runs after the row is persisted:

```
After email send succeeds (or is suppressed via failureReason):

1. Look up the user's `scope=PUSH muted=true` row → if set, return.
2. Look up the user's active PushSubscription rows.
3. Render the topic's push title + body via the existing
   `renderNotification` projection.
4. For each subscription:
   - `webPush.sendNotification({ endpoint, keys: { p256dh, auth } },
       JSON.stringify({ title, body, url, topic }))`
   - On 404 / 410 / `InvalidRegistration`: delete the row.
   - On any other error: log + continue (no row delete).
5. Continue worker return shape unchanged.
```

The "after email" sequencing means a failed email doesn't
short-circuit push delivery — they're independent fanouts, both
gated on per-scope mutes.

Idempotency: BullMQ retries the whole job; the worker re-renders

- re-sends to every active subscription. Push services dedupe by
  their own request fingerprint (best-effort) — for v1 we accept
  that a retry could surface a second system notification on a
  flaky network. The 10.2 stuck-notifications sweeper still skips
  finalized rows.

## 7. Permissions

User push-subscription routes are scoped to the authenticated
user. No admin write surface (mirrors 10.4's admin tooling: read-
only support). No cross-user delete.

## 8. Edge cases

- **User disables push in browser settings**: next worker attempt
  hits `410 Gone`; we delete the row. The next dispatch finds no
  subscriptions and silently no-ops the push branch.
- **Multiple browsers / devices**: same user can have N rows. Each
  carries its own endpoint + keys. v1 caps at 10 per user to avoid
  spammy fanouts (server-side check; client gets a 422 on the
  11th).
- **VAPID keys not configured**: the env-loader exposes
  `VAPID_PUBLIC_KEY` as optional. When absent, the worker logs
  `vapid disabled — skipping push fanout` once on boot + falls
  through. `POST /push-subscriptions` returns 503
  `push.provider_disabled` so the client doesn't store keys we
  can't honor.
- **Subscription with malformed keys**: `web-push` throws
  synchronously on send; we treat the error like a 410 and delete
  the row. Logged at warn.
- **Concurrent re-subscribe**: the same browser re-subscribing
  produces the same endpoint but possibly new auth keys. The
  unique constraint on `(userId, endpoint)` + the upsert pattern
  in POST handles this without churn.
- **User erases account (Phase 9.3)**: `onDelete: Cascade` drops
  the subscription rows. The S3 + PostHog erasure flow doesn't
  need a separate push purge.

## 9. Out of scope

- **Other PWAs (owner / partner / admin)**: same pattern; lands in
  10.5b. The backend supports all four roles today.
- **Per-topic push customization**: v1 sends a single
  `{ title, body, url, topic }` payload to all subscriptions. No
  topic-specific URL targeting yet — the URL is the relevant
  app's `/notifications` route.
- **Push for unauthenticated users**: not supported. Marketing
  / public-campaign pushes are a separate non-goal.
- **iOS Safari PWA**: requires the user to add-to-home-screen
  first; we don't UI-prompt for that in v1 but the backend works
  if they do.
- **Native mobile apps (FCM / APNs)**: explicitly deferred to a
  future native-app slice; no server changes here would carry over.
- **Push template internationalization**: render is one language
  (English) for v1, matching the email templates.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] Migration adds `PushSubscription` + the `PUSH` enum value cleanly on a fresh DB.
- [ ] `PushSubscriptionsService` unit-tested for: upsert on re-subscribe (no duplicate row), per-user 10-row cap, 404 on cross-user delete.
- [ ] `NotificationsSendWorker.process` unit-tested for: push fanout fires after email, push muted via `scope=PUSH muted=true` row skips fanout, 410 from `web-push` prunes the row, other errors log but don't prune.
- [ ] The tenant PWA renders a single-click "Enable push" button on `/notifications`; clicking it requests permission, registers a subscription, and POSTs to the API.
- [ ] When the tenant's preference shows `PUSH muted`, a re-trigger of `bill.issued` only updates the in-app row and email (no push send).
- [ ] `web-push` is declared as a direct dep of `apps/api`.

## 11. Manual test plan

1. Generate a VAPID keypair (`npx web-push generate-vapid-keys`) and set `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` in the API env, plus `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in tenant.
2. Start API + Redis + tenant PWA + a real mailer.
3. Sign in as a tenant. Navigate to `/notifications`, click "Enable push", accept browser prompt. A row lands in `PushSubscription` keyed on the device's endpoint.
4. Trigger a `bill.issued` (e.g. via the bills generate-now route as the owner). Confirm:
   - In-app row appears in the bell.
   - Email lands in MailHog.
   - Browser shows a system notification within ~2s.
5. Mute the push channel via `PUT /v1/notifications/preferences/bill.issued` with `{ scope: 'PUSH', muted: true }`. Trigger again. In-app + email fire; no system notification.
6. Disable push in the browser settings. Trigger again. The worker hits a 410; the subscription row is deleted automatically.

## 12. Rollout

- Forward-only Prisma migration; additive only.
- New optional env vars; existing deploys continue to boot without
  `VAPID_*` set (push fanout becomes a no-op, logged at boot).
- Direct dep `web-push` added; pnpm install picks it up. No
  breaking peer changes (web-push is a leaf node-only package).
- No feature flag; the worker degrades gracefully when VAPID keys
  aren't set.
- Pre-10.5 users land with `pushSubscriptions = []` and the
  default `scope=PUSH muted=false`. Tenant PWA opt-in is per-user
  via the new button.
