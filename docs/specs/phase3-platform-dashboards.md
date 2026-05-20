# Spec: Platform dashboards (phase 3.4c)

> Status: **implemented (sans Playwright e2e)**
> Phase: 3
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Admins have user-moderation (3.4a) and house-moderation (3.4b) tools, but
no overview of how the platform is doing. "Is GMV going up?", "Are there
20 overdue bills or 2,000?", "How long do tickets sit?" — these questions
should be one click off the admin landing page, not a SQL session.

This slice ships a single read-only `/v1/admin/dashboard` endpoint and
the admin app's `/dashboard` page. Math lives in the API so the four
frontends never compute it differently.

## 2. User stories

- As an **admin**, I want to see total / suspended / pending-KYC user
  counts so I can spot trouble at a glance.
- As an **admin**, I want to see GMV (paid bills) all-time and over the
  last 30 days, broken down by currency, so I can track platform revenue
  without an FX assumption.
- As an **admin**, I want to see how many bills are overdue and how much
  money is at risk, so I know whether to nudge owners.
- As an **admin**, I want to see open tickets and the median time-to-
  resolve, so I know whether the support load is healthy.
- As an **admin**, I want to see the moderation backlog (flagged
  houses) so I can decide where to spend a slow Tuesday.

## 3. Screens / surfaces

| Surface      | App   | Route                     | Notes                            |
| ------------ | ----- | ------------------------- | -------------------------------- |
| Dashboard    | admin | `/dashboard`              | KPI cards. SSR; no client state. |
| Landing      | admin | `/`                       | New "Dashboard" tile             |
| API endpoint | api   | `GET /v1/admin/dashboard` | ADMIN-only                       |

No charts in v1 — numbers and lists. Charts can land when we have
enough data to make a sparkline interesting.

## 4. API shape

```ts
// @repo/shared/schemas/platform-dashboard.ts
export const moneyByCurrencySchema = z.object({
  currency: currencySchema,
  /** Minor units. */
  amount: z.number().int().nonnegative(),
});

export const platformDashboardSchema = z.object({
  users: z.object({
    total: z.number().int().nonnegative(), // excludes soft-deleted
    suspended: z.number().int().nonnegative(),
    pendingKyc: z.number().int().nonnegative(),
    activeIn7d: z.number().int().nonnegative(), // lastLoginAt >= now-7d
    activeIn30d: z.number().int().nonnegative(),
  }),
  houses: z.object({
    total: z.number().int().nonnegative(), // excludes soft-deleted
    published: z.number().int().nonnegative(),
    flagged: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  leases: z.object({
    active: z.number().int().nonnegative(),
    draft: z.number().int().nonnegative(),
  }),
  tickets: z.object({
    openCount: z.number().int().nonnegative(), // OPEN/ACKNOWLEDGED/IN_PROGRESS/REOPENED
    resolvedLast7d: z.number().int().nonnegative(),
    /** Median ms between createdAt and resolvedAt over the last 30 days
     *  of resolved tickets. `null` if there are no resolved tickets. */
    medianResolveMs: z.number().int().nullable(),
  }),
  /** Sum of `Bill.total` where `status === 'PAID'`, grouped by currency. */
  gmvAllTime: z.array(moneyByCurrencySchema),
  /** Same as gmvAllTime, restricted to bills with `updatedAt >= now-30d`. */
  gmvLast30d: z.array(moneyByCurrencySchema),
  overdue: z.object({
    count: z.number().int().nonnegative(),
    byCurrency: z.array(moneyByCurrencySchema),
  }),
  generatedAt: isoDateTimeSchema,
});
```

### Endpoints

| Method | Path                  | Role  | Description                |
| ------ | --------------------- | ----- | -------------------------- |
| GET    | `/v1/admin/dashboard` | ADMIN | Platform-wide KPI snapshot |

## 5. Data model changes

None. Every KPI reads existing tables.

## 6. Workers / jobs

None. Computed on read.

Scale assumption: at < ~10k users / ~10k bills the parallel reads + JS
reductions are fine. Beyond that we should either materialize this
table or push the heavier sums (`gmvAllTime` over all-time PAID bills)
into a single SQL aggregate; flagged in the service docstring.

## 7. Permissions

- ADMIN-only via `@Roles('ADMIN')` on the controller.
- No ownership scoping — it's a platform aggregate. Suspended admins
  can't reach it because `AuthGuard` rejects them before the controller.

## 8. Audit log

None. The dashboard is read-only; no mutating action is taken.

## 9. Edge cases

- **No data** — every count is zero, GMV arrays empty,
  `medianResolveMs` is `null`. UI shows "—" for the median.
- **Tickets resolved in zero ms** (resolvedAt === createdAt — happens
  when a test fixture sets them) — count as 0 ms. Acceptable for v1.
- **Soft-deleted rows** — all queries scope to `deletedAt: null` on
  models that have it (`User`, `House`, `Lease`, `Ticket`). `Bill` has
  no soft-delete; it's scoped by the lease's `deletedAt`.
- **Median over an even number of samples** — average of the two
  middle values (standard definition).

## 10. Out of scope

- **Time-series / charts** — single snapshot only in v1.
- **Per-owner / per-region slices** — possible later as drill-downs.
- **FX-normalized GMV** — needs an exchange-rate source.
- **Export to CSV** — later.
- **Realtime / SSE** — refresh on page reload is fine.

## 11. Acceptance criteria

- [x] `GET /v1/admin/dashboard` returns the schema above.
- [x] Non-admin caller → `403 auth.role_mismatch` (RolesGuard).
- [x] User counts exclude soft-deleted users.
- [x] House counts exclude soft-deleted houses; `flagged` and
      `rejected` come from `moderationStatus`.
- [x] `gmvAllTime` and `gmvLast30d` each emit one row per currency.
- [x] `gmvLast30d` only includes bills with `updatedAt >= now-30d`.
- [x] `overdue.byCurrency` matches the same `(ISSUED|PARTIALLY_PAID|
OVERDUE) AND dueDate < now` filter as the owner dashboard.
- [x] `tickets.openCount` covers all four "in-flight" statuses.
- [x] `medianResolveMs` is `null` when no tickets have been resolved in
      the trailing 30 days.
- [x] Empty database → endpoint returns the all-zeros shape; never 500.
- [x] Admin `/dashboard` page renders all KPI cards at 1280px and stays
      legible at 1024px (desktop-first).

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with Phase 3). Coverage held by the 9-case
`admin-dashboard.service.spec.ts` suite.

## 12. Manual test plan

1. Reset + seed a dev DB (`pnpm db:reset`).
2. Sign in as admin, open `/dashboard` → see seeded numbers.
3. Mark one bill PAID via the API → refresh → GMV updates by the bill's
   total.
4. Suspend a user from `/users/[id]` → dashboard `users.suspended`
   increments.
5. Flag a house from `/houses/[id]` → `houses.flagged` increments.
6. Sign in as a tenant on a tenant-app tab → calling
   `/v1/admin/dashboard` returns 403.

## 13. Rollout

- No flag. No migration. Read-only addition.
- Backfill: none.
- Comms: changelog note ("admin dashboard is live").
