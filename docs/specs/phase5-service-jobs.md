# Spec: Service job lifecycle for direct booking (phase 5.2)

> Status: **implemented (sans Playwright e2e)**
> Phase: 5
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

5.1 stood up partner profiles + service catalogs but nobody can book
anybody. This slice opens the booking flow for **direct** bookings —
an owner picks a partner, requests a job, the partner quotes, the
owner accepts, the partner does the work + marks complete. The
status machine that lives here gets reused by 5.3 (book-from-ticket)
and 5.4 (payments).

## 2. User stories

- As an **owner**, I want to request a job from a partner with a
  short description so they can quote.
- As an **owner**, I want to see incoming quotes and accept the one
  I like.
- As an **owner**, I want to cancel a job that hasn't started so I
  don't get billed.
- As a **partner**, I want to see incoming requests and respond with
  a quoted amount.
- As a **partner**, I want to mark a job in-progress and then
  complete it, attaching photos as proof of work.
- As either party, I want to cancel a job with a reason so the other
  side knows why and the audit trail captures it.

## 3. Screens / surfaces

| Surface            | App     | Route                   | Notes                                     |
| ------------------ | ------- | ----------------------- | ----------------------------------------- |
| Book a partner     | owner   | `/partners/[id]/book`   | Form. Optional unit context.              |
| Owner job list     | owner   | `/me/service-jobs`      | All jobs, status filter                   |
| Owner job detail   | owner   | `/me/service-jobs/[id]` | Accept quote / Cancel actions             |
| Partner job list   | partner | `/jobs`                 | Incoming requests + in-flight             |
| Partner job detail | partner | `/jobs/[id]`            | Quote / Start / Complete / Cancel actions |

## 4. API shape

```ts
// @repo/shared/schemas/service-jobs.ts
export const serviceJobSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  partnerId: idSchema,
  /** Joined on read; partner display + business name. */
  partnerBusinessName: z.string(),
  serviceId: idSchema.nullable(),
  serviceName: z.string().nullable(),
  ticketId: idSchema.nullable(),
  unitId: idSchema.nullable(),
  status: jobStatusSchema,
  description: z.string().max(2000).nullable(),
  quotedAmount: z.number().int().nonnegative().nullable(),
  finalAmount: z.number().int().nonnegative().nullable(),
  currency: currencySchema.nullable(),
  scheduledFor: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  cancelReason: z.string().max(200).nullable(),
  cancelledBy: idSchema.nullable(),
  proofPhotos: z.array(z.string().url()).max(20),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createServiceJobSchema = z.object({
  partnerId: idSchema,
  serviceId: idSchema.optional(),
  unitId: idSchema.optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  scheduledFor: isoDateTimeSchema.optional(),
});

export const quoteServiceJobSchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: currencySchema,
});

export const completeServiceJobSchema = z.object({
  finalAmount: z.number().int().nonnegative().optional(),
  proofPhotos: z.array(z.string().url()).max(20).optional(),
});

export const cancelServiceJobSchema = z.object({
  reason: z.string().trim().min(1).max(200),
});

export const listServiceJobsQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
});
```

### Endpoints

**Owner** (`@Roles('OWNER')`) at `/v1/me/service-jobs`:

| Method | Path          | Description                                 |
| ------ | ------------- | ------------------------------------------- |
| POST   | `/`           | Create REQUESTED job (`{ partnerId, ... }`) |
| GET    | `/`           | List jobs the owner has booked              |
| GET    | `/:id`        | One                                         |
| POST   | `/:id/accept` | `{}` → QUOTED → ACCEPTED                    |
| POST   | `/:id/cancel` | `{ reason }` → CANCELLED (any non-terminal) |

**Partner** (`@Roles('PARTNER')`) at `/v1/me/jobs`:

| Method | Path            | Description                                                |
| ------ | --------------- | ---------------------------------------------------------- |
| GET    | `/`             | List incoming + in-flight jobs                             |
| GET    | `/:id`          | One                                                        |
| POST   | `/:id/quote`    | `{ amount, currency }` → REQUESTED → QUOTED                |
| POST   | `/:id/start`    | `{}` → ACCEPTED → IN_PROGRESS                              |
| POST   | `/:id/complete` | `{ finalAmount?, proofPhotos? }` → IN_PROGRESS → COMPLETED |
| POST   | `/:id/cancel`   | `{ reason }` → CANCELLED                                   |

Owners only see jobs they booked; partners only see jobs assigned to
them. Cross-party access → 404 (existence-hiding).

## 5. Data model changes

```prisma
model ServiceJob {
  // existing fields ...

  /// Denormalized from the owner who booked this job (the partner's
  /// `userId` already lives on PartnerProfile). Frozen on create.
  ownerId String

  /// Optional context: the unit the job is being performed on.
  /// Direct bookings can leave this null; ticket-routed bookings
  /// (5.3) will fill it via the ticket's lease → unit chain.
  unitId String?

  /// Owner's free-form request note. Populated on create.
  description String? @db.VarChar(2000)

  /// Actor user id who cancelled. Frozen at cancel time.
  cancelledBy String?

  /// Image URLs from the partner's "completed" submission.
  proofPhotos String[] @default([])

  @@index([ownerId, status])
}
```

Migration: `service_job_owner_and_proof`. The `ServiceJob` table is
empty, so `ownerId` lands NOT NULL without a backfill.

## 6. State machine

```
REQUESTED ── partner.quote ─► QUOTED
REQUESTED ── owner.cancel  ─► CANCELLED
QUOTED    ── owner.accept  ─► ACCEPTED
QUOTED    ── owner.cancel  ─► CANCELLED   (decline the quote)
QUOTED    ── partner.cancel ─► CANCELLED  (withdraw the quote)
ACCEPTED  ── partner.start ─► IN_PROGRESS
ACCEPTED  ── owner.cancel  ─► CANCELLED
ACCEPTED  ── partner.cancel ─► CANCELLED
IN_PROGRESS ── partner.complete ─► COMPLETED
IN_PROGRESS ── owner.cancel ─► CANCELLED
IN_PROGRESS ── partner.cancel ─► CANCELLED
```

`RATED` is reachable only via 5.5 (rating writes flip the job to RATED).
`COMPLETED` is terminal in 5.2.

Source of truth: two maps in the service, one per actor side
(`OWNER_TRANSITIONS`, `PARTNER_TRANSITIONS`), mirroring the
ticket / lease pattern.

## 7. Workers / jobs

None. Synchronous request/response throughout.

## 8. Permissions

- **OWNER** of the job (`ownerId`): may request, accept quote, cancel.
- **PARTNER** assigned (`partnerId.userId == actor.id`): may quote,
  start, complete, cancel.
- **ADMIN**: not in this slice. Admin-side oversight of jobs lands
  with the payouts ledger in 5.4 or later.
- **TENANT**: no access.
- **Partner suspended** or **profile soft-deleted** at booking time →
  422 `jobs.partner_not_bookable`.

## 9. Audit log

Every mutation writes one row inside the same `$transaction` as the
state update:

| Action         | Target            | Meta keys                                           | Actor   |
| -------------- | ----------------- | --------------------------------------------------- | ------- |
| `job.request`  | `ServiceJob:<id>` | `partnerId`, `serviceId?`, `unitId?`                | owner   |
| `job.quote`    | `ServiceJob:<id>` | `previousStatus`, `amount`, `currency`              | partner |
| `job.accept`   | `ServiceJob:<id>` | `previousStatus`                                    | owner   |
| `job.start`    | `ServiceJob:<id>` | `previousStatus`                                    | partner |
| `job.complete` | `ServiceJob:<id>` | `previousStatus`, `finalAmount`, `proofPhotosCount` | partner |
| `job.cancel`   | `ServiceJob:<id>` | `previousStatus`, `reason`, `cancelledBy`           | either  |

## 10. Edge cases

- **Quote on a non-REQUESTED job** → 422 `jobs.invalid_transition`.
- **Accept on a non-QUOTED job** → 422.
- **Owner cancels after COMPLETED** → 422 (terminal).
- **Partner booked is suspended / has soft-deleted profile** → 422
  `jobs.partner_not_bookable` (at POST time only).
- **`serviceId` references a soft-deleted service** → still accepted;
  the FK action is `SetNull` so the job retains a snapshot of the
  service name copied at request time.
- **Currency on quote** doesn't have to match the service's currency
  (partner is free to override at quote time). If we want to lock this
  later it'll be a Phase 5+ tightening.
- **Cancel without a reason** → Zod rejects with `VALIDATION_FAILED`.

## 11. Out of scope

- **Photo upload widget** — `proofPhotos` accepts URL strings; the
  upload widget arrives with S3 storage work.
- **Book from a ticket** — 5.3.
- **Payment / commission / payout ledger** — 5.4.
- **Ratings + RATED state** — 5.5.
- **Calendar / scheduling UI** — `scheduledFor` is on the model but
  v1 only stores + displays it. Calendar widget later.
- **Notifications on state change** — Phase 5+ when Resend is wired.
- **Job messaging thread** — Phase 5+ (mirror ticket chat once needed).

## 12. Acceptance criteria

- [x] Owner POST `/v1/me/service-jobs` creates a `REQUESTED` job tied
      to the owner + partner.
- [x] Booking a partner whose profile is soft-deleted or whose user is
      suspended → 422 `jobs.partner_not_bookable`.
- [x] Partner POST `/quote` with `{ amount, currency }` → status
      `QUOTED`, audit row written.
- [x] Owner POST `/accept` → status `ACCEPTED`.
- [x] Partner POST `/start` → `IN_PROGRESS`.
- [x] Partner POST `/complete` → `COMPLETED`, `completedAt` set,
      `finalAmount` defaults to `quotedAmount`, `proofPhotos` stored.
- [x] Either party POST `/cancel` from any non-terminal status →
      `CANCELLED`, `cancelReason` + `cancelledBy` populated.
- [x] Cross-party access (other owner / other partner) → 404.
- [x] Every successful transition writes a `job.*` audit row atomically.
- [x] Rejected transitions write **no** audit row.

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with prior phases). Coverage held by the 11 cases in
`service-jobs.service.spec.ts`.

## 13. Manual test plan

1. As owner1 from `/partners/<id>` → "Book" → fill description → see
   new REQUESTED job in `/me/service-jobs`.
2. Sign in as that partner → `/jobs` → click the job → "Quote" with
   amount + currency → QUOTED.
3. As owner1, accept the quote → ACCEPTED.
4. As partner, "Start" → IN_PROGRESS; "Complete" with a photo URL →
   COMPLETED.
5. Spot-check the audit log: six rows (`job.request` → `job.quote` →
   `job.accept` → `job.start` → `job.complete`), all newest first.

## 14. Rollout

- No flag. Migration is additive (table empty).
- Comms: dev changelog note ("direct partner booking live; ratings + payouts next").
