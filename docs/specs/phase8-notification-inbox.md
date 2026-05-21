# Spec: In-app notification inbox (phase 8.3)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

Phase 8.2 wired seven state transitions to populate the `Notification`
table; nothing reads from it yet. This slice gives each app a
`/notifications` inbox + unread badge so users see what landed without
opening their email. The same `Notification` rows back both — no
separate "in-app message" model.

The inbox is read-only by design: each row already includes a deep-link
hint via the topic `data` payload (e.g. `data.billId` from 8.2's
templates), but rendering that link is the inbox UI's job — the API just
hands rows over.

## 2. User stories

- As a **tenant**, I see a red dot on the bell when a new bill or
  resolved ticket arrives, click through to the inbox, then drill into
  the underlying bill / ticket.
- As an **owner**, I open the inbox and find tenant tickets + completed
  jobs grouped by recency; clicking an unread row marks it read.
- As a **partner**, I see payout disbursement confirmations next to the
  bank reference so I can match my statement.
- As an **admin**, I get the same inbox surface — but the only thing
  feeding it in v1 is whichever future audit-driven dispatch lands
  (admin has no 8.2 wiring, so it's empty until then).
- As any user, I can `Mark all as read` so the badge clears in one
  click after I've skimmed.

## 3. Screens / surfaces

| Surface              | App                        | Route                                       | Notes                                                                         |
| -------------------- | -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| Inbox page           | tenant/owner/partner/admin | `/notifications`                            | Cursor-paginated list. Row click → mark-read + deep-link.                     |
| Bell + badge         | tenant/owner/partner/admin | header on `(authed)` layout                 | Polls `GET /v1/notifications/unread-count` every 60s; shows red dot when > 0. |
| Shared UI primitives | `@repo/ui`                 | `NotificationBell`, `NotificationInboxList` | Components every app composes. Keeps per-app code thin.                       |

## 4. API shape

```ts
// packages/shared/src/schemas/notifications.ts (additions)

export const markNotificationReadSchema = z.object({
  id: idSchema,
});
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;

export const unreadCountResponseSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;

// `notificationSchema` + `listNotificationsQuerySchema` are already
// exported from 8.2.
```

Endpoints (all under `/v1/notifications`, gated by AuthGuard,
scoped to the authenticated user — no role check needed since
`Notification.userId` is the filter):

| Method | Path                             | Role(s) | Description                                                                                    |
| ------ | -------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/v1/notifications`              | any     | List the caller's notifications. Query: `limit`, `cursor`, `sort`, `unread=true/false`.        |
| GET    | `/v1/notifications/unread-count` | any     | Returns `{ unread: N }`. Used by the bell.                                                     |
| PATCH  | `/v1/notifications/:id/read`     | any     | Idempotent: sets `readAt = now()` if null; 404 if not the caller's row.                        |
| POST   | `/v1/notifications/read-all`     | any     | Bulk: sets `readAt = now()` on every unread row owned by the caller. Returns `{ updated: N }`. |

No DELETE endpoint in v1 — soft-delete semantics aren't worth modeling
when the row carries diagnostic value (delivery state). Hard delete
ships with the GDPR-erasure flow if and when we need it.

## 5. Data model changes

None. The `Notification` model already has every column we need:
`userId, channel, topic, title, body, data, readAt, sentAt,
failureReason, createdAt`. Indexes on `(userId, readAt)` and
`(userId, createdAt)` already exist.

No migration in this slice.

## 6. Workers / jobs

None. Inbox is HTTP-only.

## 7. Permissions

- **All four roles** can read their own inbox + mark their own rows.
- **Existence-hiding 404** when an actor accesses someone else's
  notification id (the standard convention — same as bills/tickets).
- No ADMIN bypass. Admins read their own inbox via the same path; they
  can't view another user's inbox in this slice (admin audit lands
  later if needed).

## 8. Edge cases

- **Concurrent mark-read** — two tabs PATCH the same id. Idempotent: we
  use `updateMany({ where: { id, userId, readAt: null }, data: { readAt: now() } })`
  and accept `count: 0` as a no-op (already read).
- **Mark-all-read race** — between read and write, new rows can land
  with `sentAt: null`. The mark-all updates `WHERE userId = me AND
readAt IS NULL AT THE MOMENT`, so newer rows that race in stay
  unread. That's the desired behavior — the badge re-lights itself.
- **High volume** — `unread-count` is hot; the existing `(userId,
readAt)` index makes it a cheap point COUNT. We don't materialize
  the count anywhere.
- **Stuck deliveries (sentAt: null, failureReason: not null)** — the
  inbox still shows them since the in-app row is the source of truth.
  Tenants don't get the email but they still see the notification.
  Mark-read works the same way.
- **Missing email user** — `Notification` has a User FK; we ship a
  `select: { displayName: true }` projection on reads, not the full
  user. Cookie auth already mounts the actor, so the inbox queries
  don't need the row's user beyond the FK guard.

## 9. Out of scope

- Per-topic filters in the inbox UI (deferred to a polish slice).
- Web push / desktop notifications (no provider chosen).
- Real-time updates (no SSE / WebSocket in v1; the 60s poll on the
  bell is enough — emails get there fast, in-app freshness is bonus).
- Admin "view as user" inbox audit (deferred until support actually
  needs it).
- Notification preference center ("turn off ticket emails") — Phase 9
  or later.

## 10. Acceptance criteria

- [ ] `GET /v1/notifications` returns the caller's rows, newest first
      by default, paginated via cursor (`{ items, nextCursor }`).
- [ ] `GET /v1/notifications?unread=true` filters to `readAt IS NULL`.
- [ ] `PATCH /v1/notifications/:id/read` is idempotent: a second call
      returns the same shape; cross-user ids → 404.
- [ ] `POST /v1/notifications/read-all` updates only the caller's
      unread rows and returns the count.
- [ ] `GET /v1/notifications/unread-count` matches a Prisma count of
      `{ userId: me, readAt: null }`.
- [ ] `@repo/ui` exports `NotificationBell` and `NotificationInboxList`
      consumable from all four apps.
- [ ] Each PWA has a `/notifications` page that uses the shared list +
      links from the home / header.
- [ ] Mobile-first: inbox renders cleanly at 375px (tenant test).
- [ ] Tests: notifications-inbox service spec covers ownership, the
      idempotent mark-read path, mark-all-read scope, and unread-count.

## 11. Manual test plan

1. Boot the API + tenant + owner apps locally.
2. As a tenant on a lease with bills, hit "Generate bill" from owner;
   refresh the tenant /notifications — see a `bill.issued` row,
   unread, with the bill amount + due date in the body.
3. Click the row — observe `readAt` set on refresh + the bell badge
   decrement.
4. Open the bell from any page — verify the dot shows non-zero counts
   for unread rows.
5. Click `Mark all as read` — observe rows turn read + bell clears.
6. Open the owner app as the recipient of the same tenant's ticket;
   verify a `ticket.opened` row arrives.
7. On a 375px viewport, confirm the inbox is single-column with no
   horizontal scroll.

## 12. Rollout

- No feature flag — read-only inbox is harmless even with zero rows.
- No migration.
- No backfill: 8.2's writes started populating the table at deploy
  time. Pre-8.2 users will see an empty inbox.
- Comms: a one-line in-app banner ("Now: an inbox for your bills,
  tickets and payouts") could land later as a release-notes thing,
  but isn't required for v1.
