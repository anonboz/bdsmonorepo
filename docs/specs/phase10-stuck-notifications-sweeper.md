# Spec: Stuck-notifications sweeper (phase 10.2)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8.2 ships the `notifications.send` queue with three BullMQ
attempts + exponential backoff. That handles transient mail-provider
flakes well, but it doesn't cover the wider class of "the row never
got a job at all" — e.g. the API enqueued, Redis was down, the
producer logged a warning, and the row sat with `sentAt IS NULL,
failureReason IS NULL` indefinitely (see
`NotificationsService.dispatch`'s enqueue-error catch block).

It also doesn't cover the rarer "worker dropped the job between
attempts" path (process killed, queue purged) where BullMQ doesn't
fire its `failed` handler, so `failureReason` stays null and the row
goes silently stale.

Today ops would have to grep the DB manually. Phase 10.2 adds the
sweeper Phase 8.2 explicitly deferred as a "follow-up": a scheduled
BullMQ job that finds these rows + re-enqueues them, audits each
retry, and gives up cleanly after a small number of attempts so the
table doesn't grow a hot tail of zombie rows.

## 2. User stories

- As **ops**, I see at `/v1/admin/metrics` that the
  `notifications.stuck-sweep` queue ran recently, picked up zero or
  more rows, and the audit log has a `notification.sweep.retry` row
  for every re-enqueue. No row goes silently stale for more than an
  hour past its creation.
- As **ops**, after a Redis outage I can confirm that the pile of
  notifications produced during the outage is drained automatically
  once Redis returns. I don't have to write a one-off backfill.
- As **a developer**, when I look at a notification row in
  Prisma Studio I can tell whether it was re-tried (`retryCount > 0`,
  `lastAttemptAt` set) without consulting external logs.

## 3. Screens / surfaces

Sweeper-only — no UI. The acceptance surfaces are:

| Surface          | App / file                                                  | Notes                                                                                                |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| BullMQ scheduler | `apps/api/src/notifications/notifications.sweeper.ts` (new) | Mirrors `payouts.release-sweeper.ts`. Registers a repeat job; the same class processes it.           |
| Service          | `apps/api/src/notifications/notifications.service.ts`       | New `findStuck()` + `markRetry()` + `markStuck()` methods. Keeps Prisma access in the service layer. |
| Schema           | `packages/db/prisma/schema.prisma`                          | `Notification.retryCount Int @default(0)`; `Notification.lastAttemptAt DateTime?`.                   |
| Metrics          | `apps/api/src/admin/admin.metrics.controller.ts`            | New `notifications.stuck-sweep` queue counts row alongside the existing sweepers.                    |
| Queue names      | `apps/api/src/queues/queue-names.ts`                        | `QUEUE_NOTIFICATIONS_STUCK_SWEEP`, `JOB_NOTIFICATIONS_STUCK_SWEEP`, `REPEAT_JOB_ID_*`.               |

No HTTP surface — sweeper is purely internal.

## 4. API shape

No HTTP routes added. The sweep is invoked by BullMQ on a cron.

Service surface (internal to `apps/api`):

```ts
class NotificationsService {
  /**
   * Returns rows where `sentAt IS NULL AND failureReason IS NULL`
   * older than 1 hour, capped at `limit`. Ordered by createdAt
   * ascending so the oldest rows clear first.
   */
  findStuck(opts: { olderThan: Date; limit: number }): Promise<Notification[]>;

  /**
   * Increments retryCount, sets lastAttemptAt = now(), and returns
   * the new count. Writes a `notification.sweep.retry` audit row.
   */
  markRetry(tx: Prisma.TransactionClient, row: Notification): Promise<number>;

  /**
   * Sets failureReason = '<stuck-message>' so the row no longer
   * matches the sweeper's eligibility filter. Writes a
   * `notification.sweep.give-up` audit row.
   */
  markStuck(row: Notification, reason: string): Promise<void>;
}
```

## 5. Data model changes

```prisma
model Notification {
  // ...existing fields unchanged...

  /// Number of times the stuck-notifications sweeper has re-enqueued
  /// this row. The worker itself does not bump this — only the
  /// sweeper does, so the counter reflects "how many times did we
  /// have to rescue this row" rather than "how many BullMQ attempts."
  retryCount Int @default(0)

  /// Set by the sweeper each time it touches the row. Combined with
  /// `createdAt` lets ops see how long the row was stuck before the
  /// last attempt.
  lastAttemptAt DateTime?

  // ...existing indices unchanged...

  /// Index supporting the sweeper's filter:
  /// `WHERE sentAt IS NULL AND failureReason IS NULL`.
  /// Postgres-side partial index keeps it cheap as the table grows.
  @@index([createdAt], map: "Notification_sweep_idx")
}
```

Migration name: `notification_sweep_retry`.

The new index is intentionally non-partial in the Prisma model
(Prisma's partial-index support requires `@@index([..], where: ...)`
syntax that doesn't apply cleanly to all the existing migrations'
generators). The index covers the worst-case "scan all rows for ones
older than 1h" path; in practice most rows are sent within seconds
and don't survive a single sweep window.

## 6. Workers / jobs

New queue `notifications.stuck-sweep` registered alongside the
existing sweepers. Cron pattern `*/15 * * * *` — every 15 minutes.
The 1-hour minimum age means the worst-case sweep-to-action latency
is 75 minutes (60 min eligibility + 15 min next sweep), comfortable
for a "delivery is late, not lost" backstop.

Per sweep:

1. Query `findStuck({ olderThan: now() - 1h, limit: 100 })`.
2. For each row:
   - If `retryCount >= 3`: call `markStuck(row, 'sweep gave up after 3 retries')` + emit `notification.sweep.give-up` audit. Do not enqueue.
   - Else: bump retryCount + lastAttemptAt + emit `notification.sweep.retry` audit, then enqueue `notifications.send` with `attempts: 1` (no inner backoff — the sweeper itself is the backoff).
3. Return `{ inspected, retried, gaveUp }` for the BullMQ result blob ops can read in the dashboard.

Idempotency: bumping retryCount is done inside a Prisma tx so the
audit + counter move together. Re-running the sweep before the
worker fires is safe — the second sweep sees `retryCount` already
bumped and either retries again or gives up, never silently
double-counts.

API_DISABLE_QUEUES guard: same pattern as the other sweepers — when
true, the worker class isn't registered in the module providers, so
no Redis connection is attempted.

## 7. Permissions

None — sweeper is system-owned. Audit rows have a null `actorId`,
matching the existing bills/payouts sweepers.

## 8. Edge cases

- **Row with no email recipient**: today the worker logs `no-email`
  and returns success without setting `sentAt` or `failureReason`. The
  sweeper would re-pick it forever. v1 fix: the sweeper sets
  `failureReason = 'recipient has no email'` directly when it sees
  this case on the third retry (via the same `markStuck` path). A
  cleaner fix is to teach the worker to mark these rows up-front —
  deferred to a separate follow-up.
- **Race with worker success**: the worker sets `sentAt` after a
  successful send. If the sweeper picked the row a millisecond
  before, it'll enqueue a duplicate job — but the worker checks
  `sentAt` early and returns `already-sent`. No second email goes
  out.
- **Race with worker failure-handler**: the sweeper's filter
  excludes rows with `failureReason IS NOT NULL`, so a row that just
  got its failureReason set by the `OnFailed` hook isn't re-picked.
- **Redis fully down during the sweep itself**: the sweeper can't
  even register the repeat job, so it doesn't run. When Redis comes
  back, registration succeeds + the next 15-minute tick picks up
  the backlog naturally.
- **Migration on a table with millions of rows**: `retryCount` +
  `lastAttemptAt` are nullable-default → PostgreSQL alter is
  effectively instant. No backfill needed.

## 9. Out of scope

- **A real exponential-backoff curve** between sweeps. Sweep cadence
  is fixed at 15 min. Phase 9.4's quiet-hours work might revisit.
- **Dead-letter queue surface** in admin. The audit log + the
  `failureReason` field are the inspection surface; no separate UI.
- **SMS / push retries**. 10.2 only covers the EMAIL channel rows
  because that's all `notifications.send` handles today. Phase 10.5
  brings web push, which will need its own analogous worker behavior.
- **Per-topic skip rules** ("don't sweep `bill.reminder` past 24h
  because the bill is already overdue"). One canonical retry policy
  for v1.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] New migration applies cleanly on a fresh DB; `retryCount` + `lastAttemptAt` present on `Notification`.
- [ ] `notifications.sweeper.spec.ts` covers:
  - skip when row is younger than 1h
  - re-enqueue + audit on retryCount 0 → 1
  - mark stuck + audit when retryCount = 3
  - no double-bump when the worker won the race (`sentAt` set between query + tx)
- [ ] `/v1/admin/metrics` includes a `notifications.stuck-sweep` entry.
- [ ] When `API_DISABLE_QUEUES=true`, app boots without trying to register the repeat job (covered by the module-provider conditional, asserted indirectly via the existing module-level integration test pattern).

## 11. Manual test plan

1. Start API + worker + MinIO/Redis locally.
2. Seed a notification row directly via Prisma Studio with `createdAt = now() - 2h, sentAt: null, failureReason: null`.
3. Wait for the next `*/15` tick or run `pnpm exec tsx scripts/fire-stuck-sweep.ts` (one-off helper, not a permanent route).
4. Confirm: `retryCount = 1`, `lastAttemptAt` recent, `notification.sweep.retry` audit row written.
5. Repeat twice more; on the third sweep the row's `failureReason` should land + a `notification.sweep.give-up` audit row.
6. Set the test row's email recipient to null + reset its counters → confirm the no-email branch hits the same give-up path after three retries (this is an explicit gap in the worker we're papering over for now).

## 12. Rollout

- Forward-only Prisma migration — additive columns, no defaults
  needing backfill.
- No new env vars; the existing `API_DISABLE_QUEUES` toggle covers
  the disable path.
- No feature flag; the sweeper is a backstop and safe to ship "on"
  from the first deploy.
- Old rows produced before the migration land with `retryCount = 0`
  by default and are eligible for the sweeper from day one.
