# Spec: bills + bill generation (Phase 2.3)

> Status: **draft**
> Phase: 2
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

A tenant pays rent via a bill — the bill is the unit of money owed and the
hook for payments (Phase 2.5), reminders (Phase 2.7), and dashboards (Phase
2.8). Without it, the rest of Phase 2 has no anchor.

This slice ships **automatic recurring bill generation** for ACTIVE leases,
a **manual "generate now"** trigger for testing, and **read-only views** for
owner and tenant. Actual payment processing lands in 2.5.

## 2. User stories

- As an **owner**, I want the system to automatically generate this month's
  rent bill for each active lease so I don't have to remember.
- As an **owner**, I want a "generate now" button on a lease so I can test
  the flow or backfill a missed period.
- As an **owner**, I want to see all bills for a lease, including their
  status (issued / paid / overdue / void).
- As a **tenant**, I want to see my current bill and history of past bills,
  with a clear total and due date.

## 3. Screens

| Surface         | App    | Route                                                         | Notes                                 |
| --------------- | ------ | ------------------------------------------------------------- | ------------------------------------- |
| Bills card      | owner  | (card on `/houses/[id]/units/[unitId]/leases/[leaseId]`)      | Replaces Phase 2.3 placeholder        |
| Bill detail (O) | owner  | `/houses/[id]/units/[unitId]/leases/[leaseId]/bills/[billId]` | Lines + status + period               |
| My bills        | tenant | `/my-bills`                                                   | Current first, then history           |
| Bill detail (T) | tenant | `/my-bills/[billId]`                                          | Read-only; pay button stubbed for 2.5 |

## 4. API shape

```ts
// @repo/shared/schemas/bills.ts
export const billLineSchema = z.object({
  id: idSchema,
  billId: idSchema,
  kind: billLineKindSchema, // RENT | UTILITY_* | SERVICE_FEE | LATE_FEE | ADJUSTMENT | OTHER
  label: z.string().min(1).max(200),
  amount: z.number().int(), // minor units, can be negative for credits
  quantity: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
});

export const billSchema = z.object({
  id: idSchema,
  leaseId: idSchema,
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  dueDate: isoDateSchema,
  issuedAt: isoDateTimeSchema.nullable(),
  status: billStatusSchema, // DRAFT | ISSUED | PARTIALLY_PAID | PAID | OVERDUE | VOID
  subtotal: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  currency: currencySchema,
  lines: z.array(billLineSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const generateBillSchema = z.object({
  /** YYYY-MM-DD; defaults to the start of the current month on the API side. */
  periodStart: isoDateSchema.optional(),
});

export const listBillsQuerySchema = paginationQuerySchema.extend({
  status: billStatusSchema.optional(),
});
```

### Endpoints

| Method | Path                                                                   | Audience     | Notes                                |
| ------ | ---------------------------------------------------------------------- | ------------ | ------------------------------------ |
| POST   | `/v1/houses/:houseId/units/:unitId/leases/:leaseId/bills/generate-now` | OWNER        | Enqueues an immediate generation job |
| GET    | `/v1/houses/:houseId/units/:unitId/leases/:leaseId/bills`              | OWNER, ADMIN | Bills for one lease                  |
| GET    | `/v1/houses/:houseId/units/:unitId/leases/:leaseId/bills/:id`          | OWNER, ADMIN | Bill detail with lines               |
| GET    | `/v1/me/bills`                                                         | TENANT       | All bills across the tenant's leases |
| GET    | `/v1/me/bills/:id`                                                     | TENANT       | Only their own                       |

## 5. Generation contract

**One bill per lease per period.** Enforced by a `(leaseId, idempotencyKey)`
unique constraint where `idempotencyKey = "${rentCycle}:${periodStart}"`,
e.g. `MONTHLY:2026-06-01`.

`BillsService.generateForLease(leaseId, periodStart?)`:

1. Loads the lease. If status ≠ `ACTIVE`, no-op (returns existing bill if any
   and logs).
2. Computes `periodStart` (defaults to the start of the current month for
   MONTHLY, similar for other cycles) and `periodEnd` (last day of period).
3. Computes `dueDate = periodStart + 7 days`.
4. Builds `idempotencyKey` and tries `prisma.bill.create({ ..., lines: { create: [{ kind: RENT, ... }] } })`.
5. On `P2002` (unique violation), reads the existing bill and returns it
   (idempotent — safe to retry).
6. Returns the bill row with lines.

Status: created bills are immediately `ISSUED` (we don't need the DRAFT
state in the auto-generated path; the manual UI for ad-hoc bills can use
DRAFT later).

Initially only a RENT line is created. Utilities and ad-hoc lines come in a
follow-up slice (2.3b — adds an "Add line" UI to the owner bill detail).

## 6. Workers / jobs

### Queue: `bills.generate`

Job data: `{ leaseId: string; periodStart: string }`. Returned data: `{ billId: string; status: 'created' | 'idempotent' }`.

Retry: BullMQ default (3 attempts, exponential backoff).

### Repeating job: `bills.daily-sweep`

Runs daily at 03:00 UTC. Steps:

1. Find every `ACTIVE` lease.
2. For each, compute its current period's `idempotencyKey`.
3. Check `bills` table for that key on that lease. If missing, enqueue a
   `bills.generate` job with `{ leaseId, periodStart }`.
4. The worker picks each one up; idempotency catches any double-firing.

Why a daily sweep rather than per-lease cron: simpler operationally (one
schedule), self-healing for new leases activated mid-cycle, idempotent.

## 7. Data model changes

`Bill` model — adds `idempotencyKey String` + `@@unique([leaseId, idempotencyKey])`.

Migration: forward-only, name `bill_idempotency_key`.

Existing seed/data has no bills, so no backfill concerns.

## 8. Permissions

- **Owner** of the lease's parent house: enqueue + read.
- **Tenant** named on the lease: read-only via `/v1/me/bills*`.
- **Admin**: read-any via the owner-scoped endpoints (uses the same
  read-allowed check as the leases module).
- Other actors: 404.

## 9. Edge cases

- **Lease ends mid-period** — the bill for that period is still owed; we
  don't pro-rate in this slice. (Pro-rating lands as a 2.3b follow-up.)
- **Lease in DRAFT** — no bill generated; sweep skips it. UI button "Generate
  now" returns 409 `bills.lease_not_active`.
- **Worker fires twice for the same lease+period** — second attempt hits
  `P2002` on the unique constraint, service catches it and returns the
  existing bill. Idempotent end-to-end.
- **Worker crash mid-generation** — the lease row write is atomic via Prisma;
  BullMQ retries the job; second attempt is idempotent.
- **Upstash temporarily unreachable** — BullMQ's connection retry handles
  transient outages; jobs accumulate in memory then flush. Hard outage > 1h
  means missed sweeps, but next sweep heals everything (idempotent).

## 10. Out of scope

- **Ad-hoc bill lines** (utilities, fees) — owner UI to add lines lands in
  2.3b.
- **Pro-rating** when a lease starts or ends mid-period — 2.3b.
- **OVERDUE auto-transition** — runs alongside reminders in 2.7.
- **VOID action** — owner manually voids a bill via UI; lands when the
  ad-hoc-lines UI ships.
- **Receipt PDF** — Phase 2.4.
- **Payments** — Phase 2.5; until then bills stay `ISSUED` forever.

## 11. Acceptance criteria

- [ ] BullMQ connects to Upstash on API boot; `/readyz` reflects queue
      connectivity.
- [ ] Manual `POST .../bills/generate-now` enqueues a job → worker creates
      the Bill + RENT BillLine → endpoint returns 202 with the job id.
- [ ] Re-firing the same job for the same lease+period returns the existing
      bill without creating a duplicate.
- [ ] Daily sweep job is registered and the next-run timestamp is visible
      in `/readyz`'s queue checks.
- [ ] Owner can list and view bills on their leases; tenant on their own
      leases.
- [ ] Tenant cookie on owner-scoped bills endpoint → 403; owner cookie on
      `/v1/me/bills` → 403.
- [ ] All 33 turbo tasks stay green; new bill specs in
      `apps/api/src/bills/bills.service.spec.ts` covering idempotency,
      no-op-on-non-ACTIVE, and period-anchor computation.

## 12. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/owner --filter=@repo/tenant`.
2. Log in as `owner1@example.com`, navigate to the active seed lease on
   unit A1.
3. Click "Generate now" → toast confirms the job enqueued.
4. Refresh after 2-3 seconds → a new bill appears in the Bills card with
   status ISSUED, total = rent amount.
5. Click "Generate now" again → toast says "already generated" or shows
   the same bill (idempotent).
6. Log in as `tenant1@example.com` → `/my-bills` → see the bill.
7. Open `https://console.upstash.com/...` → confirm queue activity visible.
8. Open Supabase Studio → `Bill` table → confirm one row with the expected
   `idempotencyKey`.

## 13. Rollout

- One forward-only Prisma migration adding `Bill.idempotencyKey` (unique
  per lease).
- No feature flag — internal surface during build-out.
- No backfill (no existing bills).
- Daily sweep starts firing as soon as the API starts in any environment
  with `REDIS_URL` configured. Disable in test env by setting an
  `API_DISABLE_QUEUES=true` env (off by default).
