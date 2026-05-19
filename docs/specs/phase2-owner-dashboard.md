# Spec: owner dashboard (Phase 2.8)

> Status: **draft**
> Phase: 2
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

The owner app's landing page today is a "Houses" + "Coming soon" card. That
was fine for Phase 1 but doesn't carry weight once units + leases + bills
are flowing. An owner wants to land on **the four numbers that matter**
and see what needs attention.

This slice closes Phase 2's "Owner dashboard: occupancy, MRR, overdue
bills, recent payments" line item — adapted to "recent bills" while
payments are still in flight (Phase 2.5).

## 2. User stories

- As an **owner**, I want to see what % of my units are rented so I know
  if I have vacancy to fill.
- As an **owner**, I want to see my monthly recurring revenue across all
  active leases so I have a quick income snapshot.
- As an **owner**, I want a list of overdue bills so I know who to chase.
- As an **owner**, I want recent bill activity so I can confirm the
  generator is firing on schedule.

## 3. Screens

| Surface          | App   | Route        | Notes                                |
| ---------------- | ----- | ------------ | ------------------------------------ |
| Dashboard        | owner | `/dashboard` | New primary landing for owners       |
| Landing redirect | owner | `/`          | Updated to point at `/dashboard` CTA |

We keep `/` simple (signed-in name + nav cards to dashboard / houses /
coming-soon) rather than redirecting, so deep-linking back to `/` doesn't
auto-bounce.

## 4. API shape

```ts
// @repo/shared/schemas/owner-dashboard.ts
export const ownerDashboardSchema = z.object({
  occupancy: z.object({
    occupied: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    /** 0–1, rounded to 4 decimals. UI multiplies by 100. */
    rate: z.number().min(0).max(1),
  }),
  /** MRR per currency. Computed by normalizing each ACTIVE lease's
   *  rentAmount to a monthly equivalent based on rentCycle. */
  mrr: z.array(
    z.object({
      currency: currencySchema,
      amount: z.number().int().nonnegative(),
    }),
  ),
  counts: z.object({
    houses: z.number().int().nonnegative(),
    units: z.number().int().nonnegative(),
    activeLeases: z.number().int().nonnegative(),
    tenants: z.number().int().nonnegative(),
    overdueBills: z.number().int().nonnegative(),
  }),
  /** Bills with status in (ISSUED, PARTIALLY_PAID, OVERDUE) and dueDate
   *  in the past. Newest-due first, max 10. */
  overdueBills: z.array(billDashboardItemSchema),
  /** Last 10 bills issued or paid across the owner's leases. */
  recentBills: z.array(billDashboardItemSchema),
});
```

Where `billDashboardItemSchema` is a small projection — just enough for
the dashboard tables (no lines, no totals breakdown, no joined unit row
beyond a label string for the link).

### Endpoint

| Method | Path                     | Audience | Notes                               |
| ------ | ------------------------ | -------- | ----------------------------------- |
| GET    | `/v1/me/owner-dashboard` | OWNER    | Aggregates over the caller's houses |

ADMIN is **not** authorized here — the admin dashboard lands in Phase 3
with different aggregations (platform-wide).

## 5. Computation

All numbers are scoped to "houses where `ownerId === actor.id` and
`deletedAt IS NULL`," plus their non-deleted units and the related
non-deleted leases / bills.

### Occupancy

```
occupied = COUNT(unit WHERE house in {ownedHouses} AND status = 'OCCUPIED' AND deletedAt IS NULL)
total    = COUNT(unit WHERE house in {ownedHouses} AND deletedAt IS NULL)
rate     = occupied / total   (or 0 if total = 0)
```

`MAINTENANCE` units count as not-occupied (vacant equivalent).

### MRR

For each ACTIVE lease (`deletedAt IS NULL`), normalize to a monthly
equivalent:

| rentCycle | multiplier |
| --------- | ---------- |
| WEEKLY    | × 4.333    |
| MONTHLY   | × 1        |
| QUARTERLY | / 3        |
| YEARLY    | / 12       |

Then sum per currency (we don't FX-convert in this slice).

We round to the nearest integer minor unit since rentAmount is integer
minor units to begin with. The 4.333 weekly multiplier introduces some
imprecision; document it.

### Counts

- `houses` — owned, non-deleted
- `units` — across owned houses, non-deleted
- `activeLeases` — ACTIVE leases on the owner's units
- `tenants` — DISTINCT(tenantId) on those active leases
- `overdueBills` — see below

### Overdue bills

```
WHERE lease.ownerId = actor.id
  AND bill.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
  AND bill.dueDate < today
```

Note: we DON'T transition status to OVERDUE here — that's Phase 2.7's
reminder job's responsibility. The dashboard just queries what's
effectively overdue regardless of stored status.

### Recent bills

Last 10 bills (`createdAt DESC`) across the owner's leases. Mix of all
statuses.

## 6. Data model changes

None. Everything queryable from existing tables.

## 7. Workers / jobs

None. Computed on each request. The expensive bits are:

- Counts of joins — sub-50ms on Supabase free tier with our seed scale.
- Aggregates over leases for MRR — same.

If the dashboard becomes hot later, we cache for 60s via Redis (already
have Upstash). Not in this slice.

## 8. Permissions

- **OWNER** only. Tenant + admin + partner: 403 `auth.role_mismatch`.

## 9. Edge cases

- **No houses yet** — all numbers zero, empty arrays. UI renders a
  friendly empty state.
- **Multi-currency owner** — MRR returns one entry per currency, no
  cross-currency summing.
- **Owner with one unit, no leases** — occupancy 0%, MRR empty, counts
  reflect reality.
- **Bills attached to ENDED leases** — included in recent / overdue
  (they were issued during the active period and are still owed).

## 10. Out of scope

- **Charts / graphs** — text + tables only. Add Recharts later when we
  have time series worth showing (Phase 3 admin dashboards).
- **Date range filters** — defaults only; date pickers come later.
- **Recent payments** — Phase 2.5 deliverable; "recent bills" stands in.
- **Export to CSV** — later.
- **Admin platform dashboard** — Phase 3.
- **Cache** — see §7.

## 11. Acceptance criteria

- [ ] Owner GETs `/v1/me/owner-dashboard` → 200 with the schema-shaped
      payload.
- [ ] Tenant / admin → 403 `auth.role_mismatch`.
- [ ] Numbers match a hand-computed truth for the seed data:
      Sunnyside has 4 units (2 OCCUPIED, 1 VACANT, 1 MAINTENANCE), one
      owner with 2 active leases each at 500,000 VND/mo →
      `occupancy.rate = 0.5`, `mrr = [{ VND, 1,000,000 }]`,
      `counts.activeLeases = 2`.
- [ ] `/dashboard` renders the data; refresh on click reflects new
      bills generated via "Generate now".
- [ ] All 33 turbo tasks stay green; new spec in
      `apps/api/src/owner-dashboard/owner-dashboard.service.spec.ts`
      covering MRR normalization across all four cycles.

## 12. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/owner`.
2. Sign in as `owner1@example.com`, open `/dashboard`.
3. Verify counts above match.
4. Go to a lease, "Generate now" a bill → return to `/dashboard` →
   `recentBills` shows it on top.
5. Manually edit a bill's `dueDate` to yesterday via Supabase Studio →
   refresh → it appears under overdue.

## 13. Rollout

- No migration, no env var, no feature flag.
- Pure additive endpoint + new page.
