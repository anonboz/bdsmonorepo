# Spec: tickets v1 (Phase 3.1)

> Status: **draft**
> Phase: 3
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

Tenants need a way to report problems with their unit (broken AC, leaky
faucet) and ask the owner to act. Owners need a queue of those reports
they can triage and close. Tickets are the anchor for that loop.

This slice ships text-only tickets with a state machine. Photos (need
object storage), threaded chat messages (3.2), and ratings (3.3) come
in follow-up slices.

## 2. User stories

- As a **tenant**, I can raise a ticket against my active lease with a
  category (repair / report / complaint / request / other), title, and
  description.
- As a **tenant**, I can see all my tickets and their current status.
- As a **tenant**, I can reopen a ticket within 7 days if the resolution
  didn't actually work.
- As an **owner**, I have a queue of all tickets across my houses,
  sortable / filterable by status.
- As an **owner**, I can advance a ticket through its lifecycle:
  acknowledge → in_progress → resolved → closed (skips allowed for
  simple cases).
- As an **admin**, I can read any ticket for moderation. Admin moderation
  actions land in a later phase.

## 3. Screens

| Surface           | App    | Route              | Notes                                |
| ----------------- | ------ | ------------------ | ------------------------------------ |
| My tickets        | tenant | `/my-tickets`      | Open + closed groupings              |
| New ticket        | tenant | `/my-tickets/new`  | Lease picker + category picker       |
| Ticket detail (T) | tenant | `/my-tickets/[id]` | Status + body + reopen if applicable |
| Ticket queue      | owner  | `/tickets`         | All tickets across owner's houses    |
| Ticket detail (O) | owner  | `/tickets/[id]`    | Status + transitions + tenant info   |

## 4. API shape

```ts
// @repo/shared/schemas/tickets.ts
export const ticketSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  unitId: idSchema,
  houseId: idSchema,
  reporterId: idSchema,
  reporterName: z.string(),
  assigneeId: idSchema.nullable(),
  category: ticketCategorySchema, // REPAIR | REPORT | COMPLAINT | REQUEST | OTHER
  status: ticketStatusSchema, // OPEN | ACKNOWLEDGED | IN_PROGRESS | RESOLVED | CLOSED | REOPENED
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  resolvedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createTicketSchema = z.object({
  leaseId: idSchema,
  category: ticketCategorySchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
});

export const transitionTicketSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('ACKNOWLEDGED') }),
  z.object({ to: z.literal('IN_PROGRESS') }),
  z.object({ to: z.literal('RESOLVED') }),
  z.object({ to: z.literal('CLOSED') }),
  z.object({ to: z.literal('REOPENED'), reason: z.string().min(1).max(2000).optional() }),
]);

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  status: ticketStatusSchema.optional(),
  category: ticketCategorySchema.optional(),
});
```

### Endpoints

Tenant-scoped (their own tickets):

| Method | Path                             | Notes                                 |
| ------ | -------------------------------- | ------------------------------------- |
| POST   | `/v1/me/tickets`                 | Create — leaseId must be theirs       |
| GET    | `/v1/me/tickets`                 | List own                              |
| GET    | `/v1/me/tickets/:id`             | Get own                               |
| POST   | `/v1/me/tickets/:id/transitions` | Only `to=REOPENED` allowed for tenant |

Owner-scoped (queue + transitions):

| Method | Path                                   | Notes                         |
| ------ | -------------------------------------- | ----------------------------- |
| GET    | `/v1/me/owner-tickets`                 | Queue across all owned houses |
| GET    | `/v1/me/owner-tickets/:id`             | Get one (404 if not theirs)   |
| POST   | `/v1/me/owner-tickets/:id/transitions` | Owner-only transitions        |

Admin-scoped:

| Method | Path              | Notes         |
| ------ | ----------------- | ------------- |
| GET    | `/v1/tickets`     | Read-any list |
| GET    | `/v1/tickets/:id` | Read-any get  |

## 5. State machine

```
OPEN ─┬─→ ACKNOWLEDGED        (owner)
      ├─→ RESOLVED             (owner, skip ahead — minor fix)
      └─→ CLOSED               (owner, dismiss as out of scope)

ACKNOWLEDGED ─┬─→ IN_PROGRESS  (owner)
              ├─→ RESOLVED      (owner)
              └─→ CLOSED        (owner)

IN_PROGRESS ─┬─→ RESOLVED       (owner)
             └─→ CLOSED          (owner)

RESOLVED ─┬─→ CLOSED            (owner, after grace period)
          └─→ REOPENED           (tenant, within 7d of resolvedAt)

CLOSED ─→ REOPENED              (tenant, within 7d of closedAt)

REOPENED ─→ ACKNOWLEDGED         (owner)
```

`REOPENED` is treated like a fresh `OPEN` from the owner's POV — the
queue surfaces it the same way.

## 6. Data model changes

Existing `Ticket` model in `packages/db/prisma/schema.prisma` doesn't link
to a lease. **Adds** in this slice (new migration):

- `Ticket.leaseId String` (NOT NULL, FK to Lease)
- Index `@@index([leaseId, status])`

No existing tickets, so no backfill concerns.

## 7. Workers / jobs

None in this slice. Notifications on ticket events come in Phase 3.2.

## 8. Permissions

- **TENANT** of the lease named on the ticket: create, read own,
  transition `REOPENED` (within 7d window).
- **OWNER** of the parent house: read, all transitions except `REOPENED`.
- **ADMIN**: read any.
- Anyone else: 404.

## 9. Edge cases

- **Reopen window expired** → 409 `ticket.reopen_window_expired`.
- **Transition not allowed by state machine** → 422
  `ticket.invalid_transition` with `from` and `to` in `detail`.
- **Tenant creates ticket against a lease they don't own** → 404 (we
  resolve the lease first; non-tenant gets the standard not-found).
- **Tenant creates ticket against an ENDED lease** → allowed for now; the
  service warns in the response notes but doesn't block. (Real policy
  needed in a later slice — e.g., grace period after lease end.)
- **Owner transitions a ticket whose lease has ended** → allowed; owner
  is still responsible for closing the loop on past tickets.
- **CLOSED → REOPENED `closedAt` boundary check** uses `Date.now() -
closedAt.getTime() <= 7 * 24 * 60 * 60 * 1000`.

## 10. Out of scope

- **Photos** on tickets — needs object storage; lands as 3.1b.
- **Chat thread / messages** — Phase 3.2 (separate `TicketMessage` model).
- **Ratings** — Phase 3.3.
- **Auto-assign to partner** — Phase 5.
- **Notifications on ticket events** (owner gets email when raised, etc.) —
  Phase 3.2 once Resend is wired.

## 11. Acceptance criteria

- [ ] Tenant POSTs `/v1/me/tickets` with a valid `leaseId` → 201,
      status `OPEN`.
- [ ] Owner GETs `/v1/me/owner-tickets` → sees the new ticket.
- [ ] Owner transitions through ACKNOWLEDGED → IN_PROGRESS → RESOLVED → CLOSED.
- [ ] Tenant POSTs `to=REOPENED` within 7d → status flips back.
- [ ] Tenant tries REOPEN 8d later → 409 reopen_window_expired.
- [ ] Tenant on another tenant's lease → 404 on create.
- [ ] Owner on another owner's ticket → 404.
- [ ] Admin can GET `/v1/tickets/:any`.
- [ ] All 33 turbo tasks stay green; new specs in
      `tickets.service.spec.ts` covering the state machine + reopen
      window.

## 12. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/owner --filter=@repo/tenant`.
2. As tenant1, open `/my-tickets/new` → pick lease → fill title/body →
   submit → land on detail page with status OPEN.
3. As owner1, open `/tickets` → see the new ticket → click → "Acknowledge"
   → "In progress" → "Resolve".
4. As tenant1, return to `/my-tickets/[id]` → click "Reopen" → status
   flips to REOPENED.
5. As owner1, status updates in the queue.

## 13. Rollout

- One forward-only Prisma migration adding `Ticket.leaseId`.
- No env vars, no feature flag.
- No backfill (no existing tickets).
