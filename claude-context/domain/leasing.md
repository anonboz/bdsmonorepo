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
