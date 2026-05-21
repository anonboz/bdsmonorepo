# Spec: Domain event → notification fanout (phase 8.2)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

The `Notification` model has been in the schema since Phase 1.5 and
has had zero writers since. Phase 8.1 wired the mailer; this slice
wires the **state transitions that earn an email**:

| Event              | Recipient | Trigger                                                                         |
| ------------------ | --------- | ------------------------------------------------------------------------------- |
| `bill.issued`      | tenant    | `BillsService.generateForLease` (manual + sweeper)                              |
| `bill.paid`        | tenant    | manual-payment record + Stripe `checkout.session.completed` + VNPay IPN success |
| `bill.refunded`    | tenant    | `PaymentsService.refundForOwner` after the bill recompute                       |
| `ticket.opened`    | owner     | `TicketsService.createForTenant`                                                |
| `ticket.resolved`  | tenant    | `TicketsService.ownerTransition` → `RESOLVED`                                   |
| `job.completed`    | owner     | `ServiceJobsService.completeForPartner`                                         |
| `payout.disbursed` | partner   | `PayoutsService.markDisbursed`                                                  |

Each call site dispatches **next to the existing audit-log write** —
same atomic ordering, same `actorId` semantics. The fanout
persists a `Notification` row inside the same transaction as the
state change, then enqueues a BullMQ job that sends the email
async via the 8.1 mailer. Failure markers live on the row so
ops can grep one table to find stuck deliveries.

In-app inbox + unread badge ship in **8.3**; this slice already
populates the rows so 8.3 has data to render.

## 2. User stories

- As a **tenant**, when my landlord generates a bill I get an
  email with the amount + due date so I'm not surprised when it
  appears in-app.
- As a **tenant**, when Stripe confirms my payment I get an
  email receipt summary linking back to the bill.
- As an **owner**, when a tenant raises a ticket the email
  arrives within seconds with the title + lease + a link.
- As a **partner**, after an admin processes my payout I get an
  email with the bank reference so I can match my statement.
- As an **operator**, every notification row carries `topic`,
  `sentAt`, `failureReason` — debugging a "user says they didn't
  get it" is a single Prisma query.

## 3. Surfaces

| Surface              | App / file                                                                                                                              | Notes                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Notifications module | `apps/api/src/notifications/`                                                                                                           | Service + worker + templates          |
| Schema add           | `packages/db/prisma/schema.prisma`                                                                                                      | `Notification.failureReason`          |
| Shared types         | `packages/shared/src/schemas/notifications.ts` (new)                                                                                    | `notificationSchema` + topic literals |
| Queue registration   | `apps/api/src/queues/queue-names.ts`                                                                                                    | New `QUEUE_NOTIFICATIONS_SEND`        |
| Wiring               | `bills.service.ts`, `payments.service.ts`, `webhooks.service.ts`, `tickets.service.ts`, `service-jobs.service.ts`, `payouts.service.ts` | 7 call sites                          |

No UI in 8.2; 8.3 ships the inbox.

## 4. Data model

### 4.1 Schema add

```prisma
model Notification {
  // existing fields

  /// Persisted error reason when the worker's send attempt threw
  /// past max retries. Null until something goes wrong; lets ops
  /// grep `failureReason IS NOT NULL` for stuck deliveries
  /// instead of digging into BullMQ.
  failureReason String? @db.VarChar(2000)
}
```

Migration: `notification_failure`. Single additive column.

### 4.2 No new index

`(userId, readAt)` and `(userId, createdAt)` already exist and
cover the 8.3 inbox queries. A failure index could land later if
ops needs it; v1 keeps the table thin.

### 4.3 Topic taxonomy

`Notification.topic` is `VARCHAR(120)` already — free-form. The
shared schema pins the v1 set as a Zod enum so callers can't typo:

```ts
export const notificationTopicSchema = z.enum([
  'bill.issued',
  'bill.paid',
  'bill.refunded',
  'ticket.opened',
  'ticket.resolved',
  'job.completed',
  'payout.disbursed',
]);
```

## 5. Dispatch flow

```
state-transition handler (inside Prisma $transaction)
  ├─ updates the domain row                      [existing]
  ├─ writes the audit row                        [existing]
  ├─ writes the Notification row (sentAt = null) [new]
  │
  └─ on tx commit:
       enqueue `notifications.send` job with the Notification id
                                                 [new, outside tx]

worker (`notifications.send` queue)
  ├─ loads the Notification row by id
  ├─ resolves the recipient User (for `to` email)
  ├─ renders subject + html via topic template
  ├─ calls MailerService.send(...)
  ├─ on success: set Notification.sentAt = now()
  └─ on throw (past BullMQ retries):
       set Notification.failureReason = "<error.message>"
```

Persisting the row **inside** the tx means the state change and
the notification commit together — either both or neither. The
enqueue happens after commit so if BullMQ is down the row still
exists; ops can `bullmq:retry` from a dashboard or rerun the
sweep.

If the enqueue itself fails (Redis down at the moment of
commit), the row stays `sentAt: null, failureReason: null`. A
follow-up "stuck notifications" sweeper can pick those up; out
of v1 scope but easy to add later.

## 6. API shape

### 6.1 Shared schema

```ts
// packages/shared/src/schemas/notifications.ts
export const notificationTopicSchema = z.enum([...]);
export const notificationChannelSchema = z.nativeEnum(NotificationChannel);

export const notificationSchema = z.object({
  id: idSchema,
  userId: idSchema,
  channel: notificationChannelSchema,
  topic: notificationTopicSchema,
  title: z.string().max(200),
  body: z.string().max(2000).nullable(),
  data: z.unknown().nullable(),
  readAt: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
  failureReason: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
});
```

The `data` field is intentionally `unknown` here — each topic has
its own shape that templates know how to render. Strict per-topic
typing is a future polish (discriminated union by `topic`).

### 6.2 Internal service surface (no HTTP endpoints in 8.2)

```ts
@Injectable()
export class NotificationsService {
  /**
   * Persists a Notification row + enqueues the send job. Called
   * from inside a Prisma $transaction so the row commits with the
   * state change; the enqueue happens via a callback after the tx.
   */
  async dispatch(
    tx: Prisma.TransactionClient,
    enqueueAfterCommit: (jobId: string) => void,
    input: {
      topic: NotificationTopic;
      recipientId: string;
      data: Record<string, unknown>;
    },
  ): Promise<void>;
}
```

The `enqueueAfterCommit` callback is invoked synchronously by the
service — the caller (a domain service) is responsible for actually
calling it after the outer `$transaction` returns. This keeps the
enqueue out of the tx (the right place for Redis work) while
letting the service own the row-creation step.

A simpler convenience wrapper for callers that don't need fine
control:

```ts
async dispatchAndEnqueue(input: {
  topic: NotificationTopic;
  recipientId: string;
  data: Record<string, unknown>;
}): Promise<void>;
```

This one runs its own tiny `$transaction` for the row insert,
then enqueues. Used by callers that have already finished their
state change before dispatching (rare; most use the
`dispatch(tx, …)` form).

## 7. Templates

Per-topic title + email body. v1 uses a single map keyed by topic:

```ts
// apps/api/src/notifications/notifications.templates.ts
type Renderer = (data: Record<string, unknown>) => {
  title: string;          // shown in-app and as email subject
  body: string;           // plain text body for the row (in-app inbox)
  emailHtml: string;      // full HTML for the mailer
  emailText: string;      // text/plain fallback
};

export const NOTIFICATION_TEMPLATES: Record<NotificationTopic, Renderer> = {
  'bill.issued': (data) => { ... },
  'bill.paid': (data) => { ... },
  ...
};
```

Each renderer accesses `data` defensively — missing fields render
as `(unknown)` rather than throwing. The 8.1 templates shell
(`htmlShell`, `escape`) is reused for the email HTML.

## 8. Worker

`apps/api/src/notifications/notifications.worker.ts` — BullMQ
processor for the `notifications.send` queue. Mirrors the
`payouts.release-sweeper` pattern:

```ts
@Injectable()
@Processor(QUEUE_NOTIFICATIONS_SEND)
export class NotificationsSendWorker extends WorkerHost {
  override async process(job: Job<{ notificationId: string }>): Promise<void> {
    const row = await this.prisma.notification.findUnique({
      where: { id: job.data.notificationId },
      include: { user: { select: { email: true, displayName: true } } },
    });
    if (!row?.user?.email) return; // user deleted / has no email — drop
    if (row.sentAt) return; // already sent (retry collision)
    const { emailHtml, emailText } = NOTIFICATION_TEMPLATES[row.topic](row.data ?? {});
    try {
      await this.mailer.send({
        to: row.user.email,
        subject: row.title,
        html: emailHtml,
        text: emailText,
      });
      await this.prisma.notification.update({
        where: { id: row.id },
        data: { sentAt: new Date() },
      });
    } catch (err) {
      throw err; // let BullMQ retry; final failure handler sets failureReason
    }
  }
}
```

BullMQ retry config: 3 attempts with exponential backoff
(`{ attempts: 3, backoff: { type: 'exponential', delay: 2000 } }`).
On final failure, a `failed` event listener sets
`Notification.failureReason` from the error message.

`API_DISABLE_QUEUES=true` (the existing flag) skips worker + queue
registration — same as the other sweepers.

## 9. Wiring sites

Each call site picks the right `recipientId` for the topic:

| Topic              | `recipientId` source                          |
| ------------------ | --------------------------------------------- |
| `bill.issued`      | `lease.tenantId`                              |
| `bill.paid`        | `bill.lease.tenantId`                         |
| `bill.refunded`    | `bill.lease.tenantId`                         |
| `ticket.opened`    | `lease.ownerId`                               |
| `ticket.resolved`  | `ticket.reporterId` (the tenant who filed it) |
| `job.completed`    | `serviceJob.ownerId`                          |
| `payout.disbursed` | `ledgerEntry.accountUserId` (the partner)     |

Dispatch happens **inside the existing `$transaction`** so the
row commits with the state change. The caller wraps the enqueue
call in a post-tx callback (pattern shown in §6.2).

## 10. Permissions

Dispatch is internal — no public endpoints in 8.2. The 8.3 inbox
will gate reads to `userId === ctx.actorId`.

## 11. Audit

We do **not** write a new audit row per notification. The state
transition that triggered it already audited itself
(`bill.payment.confirmed`, `payout.disburse`, etc.). The
`Notification` table itself is the audit trail for fanout
deliveries — `sentAt` + `failureReason` answer "did it leave the
server?" without a parallel log.

## 12. Edge cases

- **Recipient has no email** — worker returns early, row stays
  `sentAt: null`. Inbox shows the row when 8.3 lands. Future
  channels (web push, SMS) would handle separately.
- **Recipient suspended / deleted between dispatch + send** — the
  `findUnique` returns the user (suspended) or null (deleted).
  Suspended users still get mail (auth blocks login, not
  notification). Deleted users → worker no-ops.
- **Same event fires twice** — e.g. duplicate webhook delivery
  re-confirms a payment. The webhook idempotency in 7.3 catches
  the duplicate before reaching the dispatch site; we trust that.
- **Topic with missing data fields** — defensive rendering; the
  template returns `(unknown)` placeholders rather than throwing.
- **Mailer disabled in dev** — `API_DISABLE_MAILER=true` (set by
  the e2e + tests) makes the mailer a stub. Worker still updates
  `sentAt` because the stub backend resolves successfully.

## 13. Out of scope

- **In-app inbox + unread badge** — 8.3.
- **Per-channel routing** (PUSH, SMS) — schema enum supports it;
  no senders wired.
- **Per-user opt-out preferences** — needs a settings UI; later.
- **Topic-typed `data` (discriminated union)** — polish; v1 uses
  `unknown` + defensive templates.
- **Bulk dispatch** (e.g. "all tenants in this building") —
  no caller needs it yet.
- **Locale / translation** — every template is English. i18n is
  a separate slice.
- **Stuck-notifications sweeper** — manual re-enqueue via BullMQ
  dashboard or ops script for now.

## 14. Acceptance criteria

- [ ] `Notification.failureReason` migration applies.
- [ ] `notificationTopicSchema` + `notificationSchema` exported
      from `@repo/shared`.
- [ ] `QUEUE_NOTIFICATIONS_SEND` registered; worker boots when
      `API_DISABLE_QUEUES` is unset.
- [ ] `NotificationsService.dispatch(tx, enqueueAfterCommit,
  input)` persists the row inside the caller's tx and the
      callback enqueues the BullMQ job.
- [ ] Each of the seven topics is wired at its state-transition
      call site.
- [ ] Worker sends via `MailerService` and updates `sentAt`. On
      final failure, sets `failureReason`.
- [ ] Per-topic template renderers handle missing fields without
      throwing.
- [ ] Tests cover: dispatch persists + enqueues (mocked queue);
      worker calls mailer + sets `sentAt`; worker on throw → row
      `failureReason` populated; each topic template renders
      with sample data.
- [ ] `pnpm turbo typecheck lint test` clean.

## 15. Manual test plan

1. `docker compose up -d postgres redis` + `pnpm dev`.
2. Generate a bill → check MailHog: tenant has a `bill.issued`
   email; `Notification` row in DB has `sentAt`.
3. As tenant, pay via Stripe sandbox → webhook fires → MailHog
   shows `bill.paid` email; row exists + `sentAt` set.
4. Owner refunds half → MailHog shows `bill.refunded` email.
5. Tenant raises a ticket → owner gets `ticket.opened`.
6. Owner transitions ticket to RESOLVED → tenant gets
   `ticket.resolved`.
7. Partner completes a job → owner gets `job.completed`.
8. Admin marks a payout DISBURSED → partner gets
   `payout.disbursed`.
9. Stop MailHog mid-flow → verify a row lands with
   `failureReason` after BullMQ exhausts retries.

## 16. Rollout

- One additive migration.
- No env vars beyond what 8.1 already added.
- Comms: dev changelog — "Notifications fan out from every
  notable state transition; inbox + badge in 8.3."
