# Domain — Leasing

## Inspections belong to a lease by creation window

`Inspection` has no `leaseId`. An inspection belongs to the lease on its unit
whose `createdAt` ≤ `inspection.createdAt` < the next lease's `createdAt` on that
unit (`leaseInspectionWindow` in `@repo/shared`, used by
`apps/landlord/services/inspection.service.ts` and
`apps/tenant/services/lease.service.ts`).

- Rule: create inspections only via `POST /api/leases/:id/inspections` (a lease's
  page). Never create an `Inspection` from a unit-level screen.
- Why it matters: break the window and move-in photos attach to the wrong
  tenancy — exactly the deposit-dispute evidence they exist for.
  <!-- TODO: drop this rule if Inspection.leaseId is added (handoff 2026-09-09 open-q 2). -->

## Flat monthly fees: property default → lease copy

`PropertyFee` is a property's default flat fee (internet, trash, parking,
cleaning, other); `LeaseFee` is the lease's own copy and is **what gets billed**
(`generateInvoice` adds one line per non-zero `LeaseFee`, kind of the same name,
`description` = the landlord's label or null). Rules live in
`apps/landlord/services/fee.service.ts`:

- `createLease` copies the property's fees inside the lease transaction
  (`copyPropertyFeesToLease`).
- Creating / editing / deleting a `PropertyFee` propagates **only to `draft`
  leases** of that property, and only to copies with `customized = false`.
  Active and later leases keep the amount they were created with — never
  bulk-update `LeaseFee` by `propertyFeeId` without those two filters.
- Editing a `LeaseFee` sets `customized = true`. Lease fees can change only on
  `draft` / `active` leases (409 otherwise).
- Why it matters: a property edit silently re-pricing signed, running leases
  would change tenants' bills mid-contract.
