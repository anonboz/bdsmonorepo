# Domain — Notifications

Rules for tenant/staff `Notification` rows. Producers live in
`apps/{landlord,admin,tenant}/services/notification.service.ts`.

## Producers write the notification in the event's transaction

A producer never writes a `Notification` row outside the transaction that
persists the change it announces.

- Enforced by convention: every `notify*` helper (`notifyUsers`,
  `notifyLeaseTenants`, `notifyOrgTenants`, `notifyAllTenants`) accepts
  `db | TransactionClient`, and producers (`setLeaseStatus`, `setInvoiceStatus`,
  `setMaintenanceRequestStatus`, `reportMyPayment`, `confirmPayment`,
  `rejectPayment`) pass `tx`.
- Known exception: `announcePublished` in `apps/{admin,landlord}/services/announcement.service.ts`
  still passes `db` (fan-out after the publish is saved). Don't copy that
  pattern; move it into the publish transaction when touched.
- Why it matters: a notification about a change that rolled back sends tenants
  to a record that never changed; a saved change with no notification breaks the
  "tenant is always told" contract. New producers must pass `tx`, not `db`.

## Recipients come from ownership-checked rows, never from input

`notifyLeaseTenants` / `notifyOrgTenants` / `notifyUsers` take a lease or org id
the caller has already asserted belongs to `session.organizationId` (landlord),
or a lease the caller has asserted the tenant is on (tenant). Never pass a
`userIds` array or a lease id straight from the request body.

- Enforced by convention at call sites (`invoice.service.ts`, `lease.service.ts`,
  `announcement.service.ts`, `ticket.service.ts`).
- Why it matters: otherwise a caller can fan notifications — with another org's
  property names in the body — to arbitrary users.

## `deepLink` is a route in the recipient's app

Tenant-bound rows carry tenant-app paths (`/my-bills/:id`, `/my-leases/:id`,
`/my-tickets`, `/announcements`); staff-bound rows carry landlord-app paths
(`/maintenance`, `/payments`). The inbox renders it as an app-relative `<Link>`.

- Enforced by convention only — the column is a plain string, so `typedRoutes`
  can't check it.
- Why it matters: a path from the wrong app is a dead link for the recipient.
