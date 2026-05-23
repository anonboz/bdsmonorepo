# Spec: Per-channel preferences + quiet hours (phase 10.4)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 9.4's preferences table is binary: a row exists → fully muted,
no row → fully on. Two real-world cases are unreachable today:

- "Stop spamming my inbox but keep the bell icon updated." Today a
  user mutes `bill.issued` and loses both the in-app entry and the
  email. The in-app surface is the cheaper, less-interruptive
  channel — there's no reason these have to ride together.
- "Don't email me at 3am." A landlord in Hanoi who works mornings
  shouldn't get the `bill.paid` alert vibrating their phone at
  midnight just because the cron sweeper fires in UTC.

The 9.4 spec explicitly deferred both ("per-channel mute,"
"quiet hours") to a follow-up. Phase 10.4 ships them and adds the
admin read-only surface support uses to advise users.

## 2. User stories

- As a **tenant**, I can mute `bill.issued` for email but leave the
  in-app notification on, so I still see the bell-icon dot when a
  bill drops.
- As an **owner**, I can set quiet hours 22:00–08:00 UTC; an event
  fired at 03:00 lands in my inbox immediately but the email
  delivers at 08:00.
- As **support**, I can pull `/v1/admin/users/:id/notification-state`
  and see "muted bill.issued email; quiet hours 22:00–08:00." No
  write surface — if a user wants something changed I direct them
  to the in-app settings.
- As a **developer**, I don't have to branch in dispatch callers —
  the service swallows all of this internally; callers still call
  `dispatch(tx, { topic, recipientId, data })` and get back the
  same shape as 9.4.

## 3. Surfaces

| Surface             | App / file                                                    | Notes                                                                                                                                           |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema              | `packages/db/prisma/schema.prisma`                            | `NotificationPreference.scope` enum (`ALL`/`EMAIL`/`IN_APP`); new `NotificationQuietHours` model.                                               |
| Shared types        | `packages/shared/src/schemas/notifications.ts`                | `NotificationPreferenceScope`, `notificationPreferenceSchema` gains `scope`, new `notificationQuietHoursSchema`.                                |
| Dispatch service    | `apps/api/src/notifications/notifications.service.ts`         | `dispatch` reads all per-scope prefs + quiet hours; selects in-app + email independently; supports delayed email.                               |
| Inbox service       | `apps/api/src/notifications/notifications.inbox.service.ts`   | `listPreferences` returns per-scope rows; `upsertPreference` takes (topic, scope, muted); new quiet-hours methods.                              |
| Inbox controller    | `apps/api/src/notifications/notifications.controller.ts`      | Scope-aware preference routes; new quiet-hours GET/PUT.                                                                                         |
| Admin support       | `apps/api/src/admin/admin-users.controller.ts` (new endpoint) | `GET /v1/admin/users/:id/notification-state` read-only.                                                                                         |
| Frontend (deferred) | `apps/{owner,tenant,partner}/.../preferences-card.tsx`        | Existing single-toggle UI keeps working via the `scope=ALL` legacy contract; per-channel + quiet hours UI lands as a polish follow-up in 10.4b. |

The existing single-row mute keeps its semantics: `scope=ALL` means
"every channel muted for this topic" — exactly the 9.4 behavior.
The frontends don't have to change to keep working; the new admin
read endpoint is the only consumer of the richer shape this slice.

## 4. API shape

```ts
// packages/shared/src/schemas/notifications.ts

export const NotificationPreferenceScope = {
  ALL: 'ALL',
  EMAIL: 'EMAIL',
  IN_APP: 'IN_APP',
} as const;
export type NotificationPreferenceScope =
  (typeof NotificationPreferenceScope)[keyof typeof NotificationPreferenceScope];

export const notificationPreferenceSchema = z.object({
  topic: notificationTopicSchema,
  scope: notificationPreferenceScopeSchema,
  muted: z.boolean(),
});

export const upsertNotificationPreferenceSchema = z.object({
  /** Defaults to ALL when omitted so the existing single-toggle UI
   *  keeps working unchanged. */
  scope: notificationPreferenceScopeSchema.optional(),
  muted: z.boolean(),
});

export const notificationQuietHoursSchema = z.object({
  /** Minute offset from UTC midnight. 0..1439. */
  startUtcMinute: z.number().int().min(0).max(1439),
  /** Same range; `end < start` means the window wraps midnight (e.g.
   *  start=1320 end=480 → 22:00..08:00). */
  endUtcMinute: z.number().int().min(0).max(1439),
});
export type NotificationQuietHours = z.infer<typeof notificationQuietHoursSchema>;

export const getQuietHoursResponseSchema = notificationQuietHoursSchema.nullable();
export type GetQuietHoursResponse = z.infer<typeof getQuietHoursResponseSchema>;

export const adminNotificationStateResponseSchema = z.object({
  preferences: z.array(notificationPreferenceSchema),
  quietHours: notificationQuietHoursSchema.nullable(),
});
```

Endpoints (user-facing):

| Method | Path                                   | Role(s)                       | Description                                                                                        |
| ------ | -------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/v1/notifications/preferences`        | TENANT, OWNER, PARTNER, ADMIN | Returns the per-(topic,scope) list. Topics with no rows appear once with `scope=ALL, muted=false`. |
| PUT    | `/v1/notifications/preferences/:topic` | TENANT, OWNER, PARTNER, ADMIN | Body: `{ scope?, muted }`. Scope omitted → ALL (legacy single-toggle).                             |
| GET    | `/v1/notifications/quiet-hours`        | TENANT, OWNER, PARTNER, ADMIN | `200 { startUtcMinute, endUtcMinute } \| null`.                                                    |
| PUT    | `/v1/notifications/quiet-hours`        | TENANT, OWNER, PARTNER, ADMIN | Upsert. Body validates the minute range.                                                           |
| DELETE | `/v1/notifications/quiet-hours`        | TENANT, OWNER, PARTNER, ADMIN | Clears quiet hours (no row).                                                                       |

Admin (read-only):

| Method | Path                                     | Role(s) | Description                                                    |
| ------ | ---------------------------------------- | ------- | -------------------------------------------------------------- |
| GET    | `/v1/admin/users/:id/notification-state` | ADMIN   | Returns the union of preferences + quiet-hours for the target. |

## 5. Data model changes

```prisma
enum NotificationPreferenceScope {
  /// Default. Mutes both in-app and email; mirrors the 9.4 row.
  ALL
  /// Suppress email but keep the in-app row.
  EMAIL
  /// Suppress the in-app row but still try email (rarely used; here
  /// for symmetry).
  IN_APP
}

model NotificationPreference {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  topic String                         @db.VarChar(120)
  scope NotificationPreferenceScope    @default(ALL)
  muted Boolean                        @default(true)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Old @@unique([userId, topic]) dropped in favour of including the
  // scope so the user can have multiple rows per topic.
  @@unique([userId, topic, scope])
  @@index([userId])
}

model NotificationQuietHours {
  /// One row per user (1:1) → userId is the primary key.
  userId String @id
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Both fields are minute offsets from UTC midnight (0..1439).
  /// `end < start` wraps midnight. Storing minutes (not strings or
  /// time-of-day) keeps the dispatch math trivial and DB-friendly.
  startUtcMinute Int
  endUtcMinute   Int

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Migration name: `notification_channel_prefs`.

Migration sequence:

1. Create the `NotificationPreferenceScope` enum.
2. Add `scope` column to `NotificationPreference` with default `ALL`,
   NOT NULL. Existing rows backfill to `ALL`.
3. Drop the old `(userId, topic)` unique; add `(userId, topic, scope)`.
4. Create `NotificationQuietHours`.

All-additive; the existing single-row prefs continue to work because
they default to `scope=ALL`.

## 6. Dispatch gate (the load-bearing change)

```
For each dispatch(tx, { topic, recipientId, data }):
  1. Read all NotificationPreference rows for (recipientId, topic).
     Compute booleans:
       fullMute   = any row matches { scope: ALL,    muted: true }
       emailMute  = any row matches { scope: EMAIL,  muted: true }
       inAppMute  = any row matches { scope: IN_APP, muted: true }
  2. If fullMute: return { id: null, muted: true, enqueue: noop }.
     Mirror the 9.4 behavior exactly — frontends that read the result
     don't have to branch.
  3. Read NotificationQuietHours for recipientId. If the wall-clock
     UTC-minute right now is within [start, end) (with wrap), set
     inQuietHours = true. Compute delayMs = ms until `end`.
  4. emailSuppressed = emailMute || (inAppMute && fullMute)        // never reached past step 2 but mentioned for clarity
     inAppSuppressed = inAppMute
  5. If inAppSuppressed && emailMute:
        return early (rare double-mute via two separate rows).
  6. Insert Notification row.
     - If emailMute: also write failureReason =
         'email channel muted by user preference'. The 10.2 sweeper
         skips finalized rows.
  7. enqueue closure:
     - If emailMute: no-op (row is final).
     - Else if inQuietHours: queue.add(..., { delay: delayMs }).
     - Else: queue.add(...) as today.
```

The dispatch result shape stays
`{ id: string | null; enqueue: () => Promise<void>; muted: boolean }`.
`muted` keeps its 9.4 meaning ("full mute, nothing happened") so the
existing audit-log paths don't have to change.

## 7. Permissions

User preference + quiet-hours routes are scoped to the
authenticated user (every query filters `userId = ctx.actorId`).
Admin route requires `ADMIN`; it's read-only and reads any user by
id. No write surface on the admin side — support directs users to
the in-app settings if a change is wanted, so the audit story stays
clean.

## 8. Edge cases

- **Conflicting rows** (`scope=ALL muted=true` AND `scope=EMAIL muted=false`):
  the wider mute wins because step 2 short-circuits before step 4 runs.
  The schema doesn't actively prevent these — the dispatch logic is
  the source of truth.
- **Quiet hours where `start == end`**: treat as "always muted" (24h
  window). A `start == end == 0` row is semantically equivalent to
  "no quiet hours" but we don't try to detect / normalize it; the
  client UI is expected to refuse this case.
- **Quiet-hours straddling midnight**: explicit support via
  `end < start` meaning the window wraps. `inWindow(now, s, e)` is
  `s ≤ now < e` when `s ≤ e`, otherwise `now ≥ s || now < e`.
- **Quiet-hours end exactly equals the current minute**: treated as
  _outside_ the window (half-open interval) — keeps the math
  consistent and avoids a one-minute lingering delay.
- **User deletes a preference row mid-dispatch**: same race story as
  9.4 — the dispatch tx sees the state at read time. Acceptable
  drift; the next dispatch picks up the new state.
- **`delay: 0`** when quiet-hours window has zero duration (e.g.
  data corruption): BullMQ accepts it as immediate, so the email
  fires on the next worker tick. Defensive but not visible to the
  caller.

## 9. Out of scope

- **Per-day-of-week quiet hours.** v1 is one window applied every
  day. A "weekends only" toggle is a v2 polish.
- **Timezone-aware quiet hours.** v1 stores UTC minutes. Clients
  render the conversion to the user's locale; the server doesn't
  know the user's tz. Adding `tz` is its own follow-up.
- **Push + SMS scopes.** The enum has room (`EMAIL`, `IN_APP`) for
  now; push lands in 10.5 and will add a `PUSH` scope alongside,
  not in this slice.
- **Frontend redesign.** The existing single-toggle UI in owner /
  tenant / partner stays as-is; it continues to manage `scope=ALL`
  preferences. A two-toggle (in-app vs email) UI + quiet-hours UI
  is the 10.4b polish slice.
- **Admin write tooling.** Read-only by design — support shouldn't
  be silently muting things for users.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] Migration applies cleanly on a fresh DB; existing prefs back-
      fill to `scope=ALL`.
- [ ] `NotificationsService.dispatch` unit-tested for:
  - legacy `scope=ALL muted=true` full-mute (no row, no enqueue)
  - `scope=EMAIL muted=true` partial mute (row persisted, failure-
    Reason set, no enqueue)
  - quiet hours active (row persisted, enqueue with delay)
  - quiet hours wrapping midnight (window logic)
  - no preferences + no quiet hours (legacy enqueue-now)
- [ ] `NotificationsInboxService.upsertPreference` accepts the new
      `scope` argument; missing scope defaults to `ALL`.
- [ ] `GET /v1/admin/users/:id/notification-state` returns the
      combined view; 404 for an unknown user id (mirrors the rest of
      the admin endpoints).
- [ ] The existing single-toggle PreferencesCard in each PWA
      continues to read + write the legacy preference shape without
      modification (assertion in the API contract, not in the PWA's
      bundle).

## 11. Manual test plan

1. Start API + Redis + a real mailer locally.
2. Log in as a tenant. POST a Notification dispatch (via a test
   helper or the bills create flow). Confirm: row appears in
   `/v1/notifications`, email lands in MailHog.
3. PUT `/v1/notifications/preferences/bill.issued` with
   `{ scope: 'EMAIL', muted: true }`. Re-trigger the dispatch.
   Confirm: row appears in `/v1/notifications`, no email lands in
   MailHog. Row in DB has `failureReason` set.
4. PUT `/v1/notifications/quiet-hours` with
   `{ startUtcMinute: 0, endUtcMinute: 1440 - 1 }` (effectively all
   day). Reset the EMAIL preference. Re-trigger dispatch. Confirm:
   row appears immediately, email is queued with a 24h-ish delay.
5. Hit `/v1/admin/users/<id>/notification-state` as an admin.
   Confirm both prefs + quiet-hours fields render correctly.

## 12. Rollout

- Forward-only Prisma migration; additive only.
- No env vars added.
- No feature flag — the new shapes are opt-in via the new
  endpoints. The legacy single-toggle PUT keeps working.
- No data backfill needed past the default-value column add.
