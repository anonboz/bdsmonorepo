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
