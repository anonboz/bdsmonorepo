# Domain — Rent & utility billing

Invariants for invoice generation and the utility-pricing chain. Enforced in
`apps/landlord/services/invoice.service.ts` and
`apps/landlord/services/utility-rate.service.ts`; mirror any change in
`packages/db/prisma/seed.ts`.

## Invoice totals must match their line items

An invoice's `amount` must equal the sum of its `InvoiceLineItem.amount`, and
each metered line's `amount` must equal `round(quantity × OrgUtilityRate.pricePerUnit)`.

- Enforced in `generateInvoice` (`invoice.service.ts`) and mirrored in `seed.ts`.
- Why it matters: the tenant list/detail and outstanding-balance math derive from
  both `invoice.amount` and the per-line amounts. If they diverge, the total shown
  won't match the itemization and `outstanding = amount − paid` becomes wrong.

## Owner utility prices are gated by the admin bound

An owner's `OrgUtilityRate.pricePerUnit` must fall within the admin-managed
`UtilityRateBound[minPricePerUnit, maxPricePerUnit]` for that `kind`.

- Enforced in `upsertUtilityRate` (`utility-rate.service.ts`), which re-parses the
  price against the bound and returns `400` on violation.
- Why it matters: the bound is the platform guardrail. A write that bypasses the
  service (raw Prisma) lets an org bill outside allowed prices.
- Scope: `UtilityRateBound` is **platform-global** (no `organizationId`);
  `OrgUtilityRate` is **org-scoped**. See the global-exceptions list in root
  `CLAUDE.md`.

## A new `InvoiceLineKind` needs a tenant label

`InvoiceLineKind` = `rent | water | electricity | other`. The tenant renders line
labels via `t(\`lineKinds.${kind}\`)` (`tenant.bills.detail.lineKinds.*`). Any new
enum value must get a catalog label in every tenant message file
(`en.ts`, `vi.ts`, `zh.ts`) or it renders the raw key path at runtime. Landlord/admin
utility UIs only handle `water`/`electricity`.

`MeterReading.kind` reuses this enum, so the DB accepts all four values; only the
Zod `METERED` allowlist in `meter-reading.service.ts` restricts readings to
`water`/`electricity`. A new meterable kind must be added there too, and any code
writing a `MeterReading` outside that service must enforce the same allowlist.

## Meter readings

Landlord-recorded cumulative readings, managed in
`apps/landlord/services/meter-reading.service.ts` and consumed by
`generateInvoice` (`invoice.service.ts › resolveConsumption`).

- **Consumption = `reading.value − prior.value`**, where `prior` is the
  immediately earlier reading for the same `unitId` + `kind` by `readingDate`. A
  reading flagged `isReset`, or with no prior reading, cannot be billed (409).
  Why: billing a reset reading charges the tenant for the meter's absolute value
  (e.g. a replaced meter), not real consumption.
- **Values are non-decreasing per (`unitId`, `kind`) unless the new reading is
  `isReset`.** `recordMeterReading` checks against the prior reading;
  `updateMeterReading` checks against both the prior **and** the next reading,
  since an edit can move the date. Why: a fat-fingered value otherwise yields
  silently negative or wrong consumption.
- **A reading backs at most one invoice line; once `lineItemId` is set it is
  immutable.** `updateMeterReading` / `deleteMeterReading` and
  `resolveConsumption` throw 409 on a billed reading; the `lineItemId` stamp is
  written inside the invoice-creating transaction. Why: re-billing one delta
  double-charges the tenant.
  <!-- TODO: the billed check runs outside the tx and the stamp is an
       unconditional update, so two concurrent generateInvoice calls with the
       same readingId can both succeed. Fix: stamp via updateMany({ where:
       { id, lineItemId: null } }) and 409 on count 0; then drop this note. -->

## Payments — invoice status is derived from settled payments

When a payment is confirmed, the invoice status is recomputed from
`SUM(Payment.amount WHERE status = succeeded)` vs `invoice.amount` inside the
same transaction; `void` is preserved. Nothing else on the payment path writes
`paid` / `partially_paid`.

- Enforced in `confirmPayment` (`apps/landlord/services/payment.service.ts`,
  `tx.payment.aggregate`).
- Caveat: `setInvoiceStatus` (`invoice.service.ts`) is a second, **manual**
  writer — staff can mark `paid` with no `Payment` row. Until that is resolved,
  don't add a third writer; derive from payments.
- Why it matters: two writers disagree; the aggregate is the source of truth.

## Payments — at most one pending Payment per invoice

A tenant cannot report a payment while another is `pending` on the same invoice.

- Enforced **in the app only**: `reportMyPayment`
  (`apps/tenant/services/bill.service.ts`) throws `ConflictError` (409). No DB
  constraint — a raw insert or a new writer bypasses it.
- Why it matters: two pending rows for one balance double-notify staff and let
  a landlord confirm both, over-settling the invoice.

## Payment methods — offered = admin-enabled ∩ org-accepted (∩ configured)

The tenant app only shows, and only accepts a report for, a method that is
`enabled` in `PaymentMethodCatalog` **and** listed in the org's
`OrgPaymentSettings.acceptedMethods` — and, for `bank_transfer`, has bank BIN +
account number + account name set.

- Enforced in `getMyBill` / `reportMyPayment` (tenant `bill.service.ts`);
  `upsertPaymentSettings` (landlord `payment-settings.service.ts`) rejects
  non-enabled keys with 409.
- Why it matters: an admin switching a method off must take effect everywhere at
  once; an org must not advertise an unsupported method; a bank-transfer row
  without account details renders a broken QR.
- See the `PaymentMethodKey` vs `PaymentMethod` trap in `claude-context/gotchas.md`.
