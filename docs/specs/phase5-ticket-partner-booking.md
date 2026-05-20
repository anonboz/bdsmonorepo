# Spec: Book a partner from a ticket (phase 5.3)

> Status: **implemented (sans Playwright e2e)**
> Phase: 5
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Owners filing tickets shouldn't have to copy-paste the issue into a
separate booking flow. 5.2 ships direct booking; 5.3 lets the owner
hand a ticket straight to a partner. Schema already supports it —
`ServiceJob.ticketId` exists from the Phase 1 scaffold — so this slice
is mostly a thin server check plus a UI thread.

## 2. User stories

- As an **owner** reading a ticket, I want to request a partner to do
  the work without retyping the issue.
- As an **owner**, I want to see which partner jobs are already linked
  to a ticket so I don't double-book the same problem.
- As a **partner**, I want to see when a job is tied to a ticket so I
  know it's a tenant repair (and which unit).

## 3. Screens / surfaces

| Surface                        | App   | Route                                 | Notes                                            |
| ------------------------------ | ----- | ------------------------------------- | ------------------------------------------------ |
| Ticket detail — Partner jobs   | owner | `/tickets/[id]`                       | New card listing linked jobs + Request CTA       |
| Partners browse (with context) | owner | `/partners?fromTicket=<id>`           | Threads ticketId through link clicks             |
| Partner detail (with context)  | owner | `/partners/[id]?fromTicket=<id>`      | Book button carries the param forward            |
| Book form (with context)       | owner | `/partners/[id]/book?fromTicket=<id>` | Shows ticket banner; payload includes `ticketId` |

Existing `/me/service-jobs/[id]` already shows the linked ticket via
the field — no change needed there.

## 4. API shape

```ts
// @repo/shared/schemas/service-jobs.ts (extended)
export const createServiceJobSchema = z.object({
  partnerId: idSchema,
  serviceId: idSchema.optional(),
  unitId: idSchema.optional(),
  ticketId: idSchema.optional(), // NEW
  description: z.string().trim().min(1).max(2000).optional(),
  scheduledFor: isoDateTimeSchema.optional(),
});

export const listServiceJobsQuerySchema = paginationQuerySchema.extend({
  status: jobStatusSchema.optional(),
  ticketId: idSchema.optional(), // NEW
});
```

No new endpoints — the existing `POST /v1/me/service-jobs` learns the
`ticketId` field, and `GET /v1/me/service-jobs?ticketId=...` is the
new filter.

## 5. Server-side behavior

When the owner POSTs with `ticketId`:

1. Load the ticket with its lease + unit (`lease: { ownerId, unitId,
unit: { houseId } }`).
2. Reject with 404 `jobs.not_found` if the ticket doesn't exist,
   is soft-deleted, or `lease.ownerId !== actor.id`. (Existence-hiding
   mirrors leases / tickets.)
3. Reject with 422 `jobs.ticket_not_bookable` if the ticket is in a
   terminal-ish state — `RESOLVED` or `CLOSED`. `OPEN /
ACKNOWLEDGED / IN_PROGRESS / REOPENED` are bookable.
4. Override the request's `unitId` with the ticket's unit id (the
   server is the source of truth; the client can omit it).
5. The audit row meta gains `ticketId` so the trail says "this booking
   came from ticket X".

The owner's `ownerId` is set the same way as 5.2 — from the actor's
authenticated id. We don't pull it from the ticket because a future
admin path could behave differently; keeping the actor → ownerId
mapping consistent across endpoints is more important than not
duplicating the value.

## 6. Data model changes

None.

## 7. Audit log

`job.request` already exists from 5.2. Meta gains a `ticketId` key
when the booking was ticket-routed. No new action codes.

## 8. Permissions

- **OWNER** of the ticket's lease/house: can request a partner against
  that ticket. Cross-owner ticket id → 404.
- **PARTNER**: sees the ticketId on the job (same projection as 5.2).
- **TENANT**: no change. Cannot book partners.

## 9. Edge cases

- **Ticket in RESOLVED / CLOSED** → 422 `jobs.ticket_not_bookable`.
  Owner has to reopen the ticket first.
- **Owner already booked one partner for the ticket** — that's fine.
  Tickets can have multiple jobs (e.g., first partner declined, owner
  re-routes; or multiple partners on a complex repair). The UI shows
  all of them.
- **Partner is suspended at booking time** — 422
  `jobs.partner_not_bookable` (same guard as 5.2).
- **`unitId` from input disagrees with ticket's unit** — input is
  ignored; server uses the ticket's. The Zod schema still accepts the
  field for direct bookings.
- **The ticket → service-job link is one-way**: there's no automatic
  ticket status transition when the job state changes. Owners do that
  manually. 5.4 / Phase 6 polish could automate this.

## 10. Out of scope

- **Auto-transition ticket status** based on job progress.
- **Notifications** when a partner job is created against a ticket.
- **Multi-partner conflict resolution** (only one job can be
  ACCEPTED/IN_PROGRESS) — not enforced; owner judgement.
- **Tenant visibility into the partner job** — tenants see ticket
  status, not the booking. Privacy / billing concern, revisit later.

## 11. Acceptance criteria

- [x] Owner POST `/v1/me/service-jobs` with a valid `ticketId` →
      created job has `ticketId` + `unitId` (from the ticket's lease).
- [x] Cross-owner ticket id → 404.
- [x] Booking on a `RESOLVED` or `CLOSED` ticket → 422
      `jobs.ticket_not_bookable`.
- [x] `job.request` audit row meta includes `ticketId`.
- [x] `GET /v1/me/service-jobs?ticketId=<id>` returns only jobs
      linked to that ticket.
- [x] Owner ticket detail renders a "Partner jobs" card listing those
      jobs and a "Request a partner" button.
- [x] Clicking through `/partners?fromTicket=<id>` → partner detail →
      Book preserves the `ticketId` end-to-end and the resulting job
      is linked correctly.

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with prior phases). Coverage held by the 6 new ticket-
routed cases in `service-jobs.service.spec.ts`.

## 12. Manual test plan

1. As owner1, open an active ticket on a unit you own → see the new
   "Partner jobs" card (empty).
2. Click "Request a partner" → land on `/partners?fromTicket=<id>`.
3. Open a partner → "Book this partner" → form pre-fills `ticketId`
   on submit.
4. POST succeeds → land on the new job. Confirm `ticketId` + `unitId`
   are non-null on the job detail.
5. Back on the ticket → "Partner jobs" card now lists the job.
6. Mark the ticket RESOLVED → click "Request a partner" again →
   booking fails 422.

## 13. Rollout

- No migration. No flag.
- Comms: dev changelog note ("partner jobs can be created from a
  ticket; ratings + payouts next").
