# Spec: Admin support tooling — read-only user view (phase 10.7)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Various deferrals across Phase 7-9 leave support partially blind:

- A tenant emails "what bills am I being charged for?" — support
  has no way to see the user's bill list without pulling DB rows
  by hand.
- A partner says "the owner never accepted my quote" — support
  can read the audit log, but the user-side ticket + service-job
  threads aren't surfaced anywhere in the admin app.
- An owner reaches out about a refund — support sees the payment
  row in the audit log but no payment list keyed on the owner.

Phase 10.7 closes those gaps with three **read-only** admin
endpoints + their `/admin/users/:id` UI surfaces: tickets, bills,
payments. No write access from the admin side — if support needs
to act, the user takes the action on their own surface (or the
admin uses the existing 9.3/9.6/etc. mutating endpoints which all
write audit rows).

## 2. User stories

- As **support**, when a user emails about a billing question, I
  navigate to `/users/<their id>` and see their most recent
  bills (status, amount, due date) without leaving the admin app.
- As **support**, I can see a user's tickets — both those they
  raised and those assigned to them — with the same timestamps
  the user sees so I can speak fluently to their experience.
- As **support**, I can audit a user's payment activity
  (successful, failed, refunded) to verify what the tenant or
  owner is seeing on their side.
- As an **admin**, none of these screens have action buttons.
  They're inspection-only — the only mutating tools on the user
  page are the 9.3 (erase), 9.x (suspend), 8.x (KYC), and 10.6
  (cancel erasure) admin actions that already exist.

## 3. Surfaces

| Surface         | App / file                                                                               | Notes                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API endpoints   | `apps/api/src/admin/admin-users.controller.ts`                                           | `GET /v1/admin/users/:id/tickets`, `/bills`, `/payments` — cursor-paginated.                                  |
| Service         | `apps/api/src/admin/admin-users.service.ts`                                              | `listTicketsForUser`, `listBillsForUser`, `listPaymentsForUser`. Reuses existing list patterns + Zod schemas. |
| Admin UI        | `apps/admin/app/(authed)/users/[id]/page.tsx`                                            | Three new cards: Tickets, Bills, Payments — each renders the API's first page.                                |
| Admin UI helper | `apps/admin/app/(authed)/users/[id]/_components/{tickets,bills,payments}-list.tsx` (new) | Per-list rendering kept in their own files so the page composition stays readable.                            |
| Shared types    | (none new)                                                                               | Reuses `ticketSchema`, `billSchema`, `paymentSchema`, `pageSchema` from `@repo/shared`.                       |

No new schema; no new env; no new queues. Pure read-side feature.

## 4. API shape

```ts
// apps/api/src/admin/admin-users.controller.ts

@Get(':id/tickets')
@Roles('ADMIN')
listTickets(
  @Param('id') id: string,
  @Query() query: PaginationQueryDto,
): Promise<Page<Ticket>>;

@Get(':id/bills')
@Roles('ADMIN')
listBills(
  @Param('id') id: string,
  @Query() query: PaginationQueryDto,
): Promise<Page<Bill>>;

@Get(':id/payments')
@Roles('ADMIN')
listPayments(
  @Param('id') id: string,
  @Query() query: PaginationQueryDto,
): Promise<Page<Payment>>;
```

Pagination is the standard `{ items, nextCursor }` shape — cursor
on `id`, ordered by `createdAt desc`. Default limit 20, max 100.
404 if the target user is missing or soft-deleted.

### Membership rules

| Resource | "Belongs to the user" when                                                                     |
| -------- | ---------------------------------------------------------------------------------------------- |
| Ticket   | `reporterId = id OR assigneeId = id`. Captures both sides of the conversation.                 |
| Bill     | `lease.tenantId = id OR lease.ownerId = id`. A tenant's bills + an owner's bills both surface. |
| Payment  | The payment's bill belongs to the user via the same lease-side join.                           |

These rules match what the user's own role-side endpoints
return (bills under `/v1/me/bills` filter on lease.tenantId, etc.),
so support sees what the user sees.

## 5. Data model changes

None.

## 6. Permissions

`@Roles('ADMIN')` on each route. The service layer 404s if the
target user doesn't exist or is soft-deleted, mirroring
`AdminUsersService.getById`.

No audit row per read — we don't log GETs. The mutating admin
endpoints already cover write-side audit.

## 7. Edge cases

- **User has zero of a given resource**: returns `{ items: [], nextCursor: null }`. UI renders an empty-state row ("No bills yet for this user.").
- **Soft-deleted (erased) user**: 404 from the service, same as the existing user-detail endpoint.
- **Cross-user data leak**: not applicable — these endpoints are admin-only, and admin is by definition cross-user.
- **N+1 in the bills + payments join**: we eagerly select the lease's tenant/owner ids alongside the bill / payment rows so a single Prisma query per page is enough. No batched re-fetches downstream.

## 8. Out of scope

- **Per-tab filtering** (status, date range, etc.). Each card
  renders the most-recent 20 rows. Drill-down comes later if
  support actually needs it; for now `/v1/admin/audit?target=…`
  covers the deep-search case.
- **Inline mutating actions** ("cancel this bill", "refund this
  payment"). Stays out by design — the 10.7 spec is read-only.
- **Export to CSV**. The admin app reads the API directly; if
  support needs bulk exports, build it later as a separate
  endpoint.
- **Cross-resource correlation views** ("this user's job-completion
  rate"). Dashboards are Phase 9.6 territory.

## 9. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] `AdminUsersService.listTicketsForUser` unit-tested for:
      includes reporter-side rows, includes assignee-side rows,
      cursor pagination shape, 404 on unknown user id.
- [ ] `AdminUsersService.listBillsForUser` unit-tested for:
      includes tenant-side rows, includes owner-side rows, ordered
      newest first.
- [ ] `AdminUsersService.listPaymentsForUser` unit-tested for:
      includes refund rows alongside the charge they reverse,
      cursor pagination shape.
- [ ] `/admin/users/:id` renders Tickets / Bills / Payments cards
      with the first page of each (server-component fetch). No
      action buttons within the cards.

## 10. Manual test plan

1. Sign in as admin.
2. Pick an existing user with at least one bill + ticket + payment in
   the seed data (or create them via the other PWAs).
3. Navigate to `/users/<id>`.
4. Confirm the new Tickets / Bills / Payments cards render with the
   expected rows.
5. Spot-check a user who is exclusively an owner — bills under their
   leases should still appear via the `lease.ownerId` arm.

## 11. Rollout

- No schema changes; ships behind the existing admin role gate.
- No env vars added.
- No feature flag — UI is additive and doesn't change any
  existing admin behavior. Pre-10.7 deploys without these cards
  continue to work; rolling forward just exposes more info.
