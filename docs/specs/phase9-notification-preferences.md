# Spec: Notification preferences (phase 9.4)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8.2 dispatches every state-transition event to every recipient
unconditionally. That's the right v1 — quiet users want to **see**
their bills land — but it also means a tenant who pays auto-debit
gets a `bill.paid` email every month they don't care about, and an
owner with many active partners gets a `job.completed` notification
they only need for ones they explicitly track.

Phase 9.4 adds the smallest possible opt-out: a per-`(user, topic)`
mute toggle. Default everywhere is **not muted** — the row only
exists when the user has explicitly muted a topic. The 8.2 dispatch
flow consults the table before persisting the Notification row, so
a muted topic gets neither the in-app row nor the email.

## 2. User stories

- As a **tenant** on auto-debit, I open `/notifications` → settings,
  mute `bill.issued`, and stop getting "your rent for May is due"
  emails I don't act on.
- As an **owner** managing a busy property, I mute `job.completed`
  (I see them in the partner dashboard anyway) but keep
  `ticket.opened` (urgent).
- As a **partner**, I keep `payout.disbursed` on — money landing in
  my account is exactly the email I want.
- As a **developer** debugging a "why didn't I get the email"
  ticket, the audit row carries the dispatch outcome
  (`SKIPPED_MUTED` vs `DISPATCHED`) so support can immediately tell
  why.

## 3. Surfaces

| Surface        | App / file                                                         | Notes                                                                                              |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Schema         | `packages/db/prisma/schema.prisma`                                 | New `NotificationPreference (id, userId, topic, muted)` model with `@@unique([userId, topic])`.    |
| Shared schemas | `packages/shared/src/schemas/notifications.ts`                     | `notificationPreferenceSchema`, `notificationPreferencesResponseSchema`, `upsertPreferenceSchema`. |
| Dispatch gate  | `apps/api/src/notifications/notifications.service.ts`              | `dispatch()` reads the preference row; muted topic skips the Notification insert + enqueue.        |
| API endpoints  | `apps/api/src/notifications/notifications.controller.ts`           | `GET /v1/notifications/preferences`, `PUT /v1/notifications/preferences/:topic`                    |
| PWA            | `apps/{tenant,owner,partner,admin}/app/(authed)/notifications/...` | "Preferences" expandable on the inbox page; toggles per topic.                                     |

## 4. Data model

```prisma
model NotificationPreference {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Free-form string matching the canonical Notification.topic
  /// values from Phase 8.2 (`bill.issued`, `ticket.opened`, ...).
  /// Stored as VARCHAR rather than an enum so adding a topic later
  /// doesn't require a migration here.
  topic  String  @db.VarChar(120)

  /// When TRUE, the dispatch flow skips inserting the Notification
  /// row AND skips the email. The row only exists when the user has
  /// explicitly muted — default behaviour is unmuted.
  muted  Boolean @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([userId, topic])
  @@index([userId])
}
```

Migration: `notification_preferences`. Additive — new table only.

`muted` defaults to TRUE so the row's presence == "muted". An
unmuted topic is the absence of a row. This keeps the table small
(only opt-outs are stored) and matches the v1 default-on policy.

## 5. API

```ts
// packages/shared/src/schemas/notifications.ts (additions)

export const notificationPreferenceSchema = z.object({
  topic: notificationTopicSchema,
  muted: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const listNotificationPreferencesResponseSchema = z.object({
  /** Every topic from the canonical taxonomy, with the user's
   *  current preference. Missing rows default to `muted: false`. */
  preferences: z.array(notificationPreferenceSchema),
});
export type ListNotificationPreferencesResponse = z.infer<
  typeof listNotificationPreferencesResponseSchema
>;

export const upsertNotificationPreferenceSchema = z.object({
  muted: z.boolean(),
});
export type UpsertNotificationPreferenceInput = z.infer<typeof upsertNotificationPreferenceSchema>;
```

Endpoints (under `/v1/notifications/preferences`, behind AuthGuard):

| Method | Path                                   | Roles | Description                                                                                                         |
| ------ | -------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/notifications/preferences`        | any   | Returns the full topic taxonomy with the caller's current mute state.                                               |
| PUT    | `/v1/notifications/preferences/:topic` | any   | Upserts (`muted: true`) creates / sets; (`muted: false`) deletes the row. Returns the updated preference row shape. |

PUT writes a row only when `muted: true` (the default-on case is the
absence of a row). When `muted: false` and a row exists, the upsert
deletes it; when no row exists, it's a no-op. The endpoint always
returns `{ topic, muted }` so the client can update its UI without
re-fetching.

## 6. Dispatch gate

```ts
// NotificationsService.dispatch — before the existing insert

const pref = await tx.notificationPreference.findUnique({
  where: { userId_topic: { userId: input.recipientId, topic: input.topic } },
});
if (pref?.muted) {
  // No row, no email. The enqueue stays a no-op so callers don't
  // need to branch — they keep their existing `if (enqueue) await
  // enqueue()` pattern.
  return { id: null, enqueue: async () => undefined, muted: true };
}
```

The return shape stays compatible: existing callers only use
`enqueue`, never the `id` (grep confirms). Adding the `muted` flag

- widening `id` to `string | null` is the smallest possible API
  change.

## 7. Permissions

- All endpoints are scoped to the authenticated user; no cross-user
  reads or writes. The Auth Guard's `req.user.id` is the only
  source of identity.
- No ADMIN bypass — admins manage their own preferences via the
  same path.
- Same `@Roles('TENANT','OWNER','PARTNER','ADMIN')` decorator
  shape as the inbox endpoints from 8.3.

## 8. PWA UI

Each per-app inbox page (`/notifications`) grows a settings
expandable above the inbox list. The shape:

```
┌─ Notification preferences ──── [expand/collapse] ─┐
│ □ Bills issued                                    │
│ □ Bills paid                                      │
│ □ Bills refunded                                  │
│ ☑ Tickets opened     (muted)                       │
│ ...                                                │
└────────────────────────────────────────────────────┘
```

Each checkbox is an immediate-PUT (no save button); failures show
inline via the existing inbox-client error path.

Per-app topics:

- **Tenant**: bill.issued, bill.paid, bill.refunded, ticket.resolved.
- **Owner**: ticket.opened, job.completed.
- **Partner**: payout.disbursed.
- **Admin**: (none yet — 8.2 doesn't fan out anything to admin).

The page filters the rendered list to topics that are relevant to
the role; the API still accepts any valid topic so the data model
stays role-agnostic.

## 9. Edge cases

- **Muted topic with a pending enqueue from before the mute**: the
  job that's already on the BullMQ queue still fires; the worker
  hits the existing Notification row (idempotent) and sends. Mutes
  only affect future dispatches.
- **Round-trip mute → unmute → mute**: the row is deleted on the
  unmute, recreated on the next mute. The `(userId, topic)` unique
  constraint makes both operations idempotent.
- **Unknown topic in PUT** (e.g. one we add later that the client
  hasn't seen): Zod rejects with `validation_failed` — the topic
  enum lives in `@repo/shared` so client + server are aligned.
- **High-volume dispatch (sweepers)**: one extra `findUnique`
  inside the existing tx. The `(userId, topic)` unique index is a
  point read, so this is cheap.

## 10. Out of scope

- **Per-channel preferences** (mute email but keep in-app, or vice
  versa). v1 muting is all-or-nothing per topic. A future
  `(userId, topic, channel)` tuple is the natural extension.
- **Quiet hours / digest preferences**. No notification scheduler
  in v1; everything fires synchronously.
- **Bulk "mute everything" toggle**. Skip per spec scope — a
  cluttered preferences list is a polish problem.
- **Default-muted topics for specific roles** (e.g. ops-internal
  events). v1 has no such topic.

## 11. Acceptance criteria

- [ ] `NotificationPreference` table created via the
      `notification_preferences` migration.
- [ ] `GET /v1/notifications/preferences` returns the full topic
      taxonomy with the caller's current state.
- [ ] `PUT /v1/notifications/preferences/:topic` upserts/deletes
      per the `muted` flag; cross-user ids implicitly 401 (the
      endpoint reads `req.user.id`).
- [ ] `NotificationsService.dispatch` returns
      `{ id: null, enqueue: noop, muted: true }` when the user has
      muted that topic — no Notification row written, no email
      enqueued.
- [ ] Each PWA's `/notifications` page exposes the toggle UI for
      role-relevant topics.
- [ ] Unit tests cover: muted topic skips insert; unmuted topic
      still writes; PUT idempotency (mute + mute again is a no-op);
      unmute deletes the row.

## 12. Manual test plan

1. Sign in as a tenant; visit `/notifications` → "Preferences" →
   toggle "Bills issued" off.
2. From the owner app, generate a bill for that tenant's lease.
3. Confirm: no email lands; the tenant's `/notifications` inbox
   shows nothing new; the audit log still has the existing
   `bill.generate` row.
4. Toggle "Bills issued" back on; generate another bill;
   confirm the email + inbox row land normally.

## 13. Rollout

- Additive migration (one new table).
- No feature flag — the muting flow is opt-in per user.
- No backfill — every user starts with zero preference rows, which
  is the "every topic on" default.
