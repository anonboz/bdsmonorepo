# Spec: leases (Phase 2.2)

> Status: **draft**
> Phase: 2
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

A lease binds a tenant to a unit for a period at a rent. It's the entity that
bills attach to, that tickets reference, and that ratings hang off. Without
leases, Phase 2.3 (bill generation) and Phase 3 (tickets) have nothing to
anchor against.

This slice ships the lease as a manually-managed record. Auto-generation of
bills lands in 2.3. Tenant-initiated termination lands later — for now the
owner controls all state transitions.

## 2. User stories

- As an **owner**, I want to draft a lease for a vacant unit with a tenant,
  deposit, and rent, then activate it, so the relationship is recorded.
- As an **owner**, I want to end an active lease at term, or terminate it
  early with a reason, so the unit can be re-leased.
- As an **owner**, I want to see all leases for one of my units, including
  ended history.
- As a **tenant**, I want to see my current lease and past leases, with rent
  and deposit visible, so I know what I'm paying.
- As an **admin**, I want to read any lease for moderation, but not mutate.

## 3. Screens

| Surface           | App    | Route                                               | Notes                             |
| ----------------- | ------ | --------------------------------------------------- | --------------------------------- |
| Lease list (unit) | owner  | (card on `/houses/[id]/units/[unitId]`)             | Replaces "Phase 2.2" placeholder  |
| New lease         | owner  | `/houses/[id]/units/[unitId]/leases/new`            | Shared `LeaseForm`                |
| Lease detail      | owner  | `/houses/[id]/units/[unitId]/leases/[leaseId]`      | Status, money, dates, actions     |
| Edit lease        | owner  | `/houses/[id]/units/[unitId]/leases/[leaseId]/edit` | DRAFT-only edits (lockdown rules) |
| My leases         | tenant | `/my-leases`                                        | Current first, then history       |
| Lease detail (T)  | tenant | `/my-leases/[leaseId]`                              | Read-only; bills card later (2.4) |

## 4. API shape

```ts
// @repo/shared/schemas/leases.ts
export const leaseSchema = z.object({
  id: idSchema,
  unitId: idSchema,
  houseId: idSchema, // denormalized for filtering / UI breadcrumbs
  ownerId: idSchema,
  tenantId: idSchema,
  status: leaseStatusSchema, // DRAFT | ACTIVE | ENDED | TERMINATED
  rentCycle: rentCycleSchema,
  rentAmount: z.number().int().nonnegative(), // minor units
  depositAmount: z.number().int().nonnegative(),
  currency: currencySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable(),
  terminationReason: z.string().max(500).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createLeaseSchema = z.object({
  tenantId: idSchema,
  rentCycle: rentCycleSchema.default('MONTHLY'),
  rentAmount: z.number().int().nonnegative(),
  depositAmount: z.number().int().nonnegative(),
  currency: currencySchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
});

export const updateLeaseSchema = z.object({
  rentAmount: z.number().int().nonnegative().optional(),
  depositAmount: z.number().int().nonnegative().optional(),
  rentCycle: rentCycleSchema.optional(),
  endDate: isoDateSchema.nullable().optional(),
}); // DRAFT-only — service rejects edits in other states

export const transitionLeaseSchema = z.object({
  to: z.enum(['ACTIVE', 'ENDED', 'TERMINATED']),
  terminationReason: z.string().max(500).optional(),
});

export const listLeasesQuerySchema = paginationQuerySchema.extend({
  status: leaseStatusSchema.optional(),
});
```

### Endpoints

Owner-scoped (nested under unit so authz is layered like Units):

| Method | Path                                                       | Notes                  |
| ------ | ---------------------------------------------------------- | ---------------------- |
| POST   | `/v1/houses/:houseId/units/:unitId/leases`                 | create DRAFT           |
| GET    | `/v1/houses/:houseId/units/:unitId/leases`                 | list for that unit     |
| GET    | `/v1/houses/:houseId/units/:unitId/leases/:id`             | get one                |
| PATCH  | `/v1/houses/:houseId/units/:unitId/leases/:id`             | DRAFT-only edits       |
| POST   | `/v1/houses/:houseId/units/:unitId/leases/:id/transitions` | activate/end/terminate |

Tenant-scoped (the tenant's own list, no nesting):

| Method | Path                | Notes                                  |
| ------ | ------------------- | -------------------------------------- |
| GET    | `/v1/me/leases`     | TENANT only — current + past, sorted   |
| GET    | `/v1/me/leases/:id` | only if the lease's `tenantId` matches |

Admin-scoped:

| Method | Path             | Notes              |
| ------ | ---------------- | ------------------ |
| GET    | `/v1/leases`     | ADMIN only — paged |
| GET    | `/v1/leases/:id` | ADMIN only         |

Tenant-initiated termination is **not** in this slice (would need a counter-sign flow from the owner; deferred).

## 5. State machine

```
DRAFT ──┬─→ ACTIVE
        └─→ TERMINATED   (cancel a never-active draft)
ACTIVE ─┬─→ ENDED        (natural end-of-term, or after endDate passes)
        └─→ TERMINATED   (early termination; reason required)
ENDED, TERMINATED: terminal
```

- Activating a `DRAFT` lease:
  - Confirms the unit's status is **not** `OCCUPIED` (no overlap with another active lease).
  - Sets the unit's status to `OCCUPIED` as a side effect.
- Ending or terminating an `ACTIVE` lease:
  - Sets the unit's status back to `VACANT`.
- `TERMINATED` requires a `terminationReason` in the transition body.

## 6. Data model changes

`Lease` is already in `packages/db/prisma/schema.prisma` from Phase 1.2.
**Adds** in this slice (new migration):

- `Lease.terminationReason String?` — needed for TERMINATED transitions.

No other schema changes; the existing indices on `(tenantId, status)`,
`(ownerId, status)`, `(unitId, status)` already support the queries below.

## 7. Workers / jobs

None in this slice. Bill auto-generation lands in 2.3 and will read from
`Lease` on its cycle anchor.

## 8. Permissions

- **Owner of the parent House**: full CRUD on leases for their units;
  state transitions.
- **Other owners**: 404 on everything (existence-hiding).
- **TENANT named on the lease**: read-only via `/v1/me/leases*`.
- **Other tenants**: 404.
- **ADMIN**: read-only via `/v1/leases*`; no mutations in this slice.

## 9. Edge cases

- **Two ACTIVE leases on the same unit** → 409 `lease.dates_overlap` when
  transitioning to ACTIVE while another is already ACTIVE on the unit.
- **Transition not allowed by state machine** → 422 `lease.invalid_transition`
  with the current and attempted states in `detail`.
- **TERMINATED with no reason** → 422 from Zod (`terminationReason` required
  when `to === 'TERMINATED'` — enforced server-side, not via discriminated
  union here for simplicity).
- **Edit attempted on non-DRAFT lease** → 409 `lease.invalid_transition`
  with detail noting "lease is locked once activated".
- **Unit goes into MAINTENANCE while a lease is ACTIVE** → allowed; doesn't
  affect the lease.
- **Tenant becomes suspended** → AuthGuard already 403s, so they can't read
  `/v1/me/leases`. Lease remains valid for billing purposes.

## 10. Out of scope

- Tenant-initiated termination (counter-sign workflow).
- Auto-end at `endDate` (would be a scheduled job — punted to 2.3 alongside
  the bill scheduler).
- Lease renewal (creates new lease referencing old) — UI shortcut, not a
  new concept; later.
- Co-tenant leases (multi-tenant per lease).
- E-signature on lease activation (Open decision in BUILD_PLAN §8).

## 11. Acceptance criteria

- [ ] Owner POSTs a draft lease for a vacant unit → activates it → unit's
      status flips to OCCUPIED → tenant sees it in `/my-leases`.
- [ ] Owner ends the active lease → unit returns to VACANT → lease shows
      ENDED status with the endedAt timestamp populated.
- [ ] Activating a second lease on the same unit while the first is ACTIVE
      → 409 `lease.dates_overlap`.
- [ ] Tenant cookie on `/v1/leases` → 403 `auth.role_mismatch`.
- [ ] Tenant cookie on `/v1/me/leases/:someoneElsesLease` → 404.
- [ ] Admin can GET `/v1/leases/:any` but POST `/v1/houses/.../leases`
      → 403.
- [ ] Editing a non-DRAFT lease via PATCH → 409 `lease.invalid_transition`.
- [ ] All 33 turbo tasks stay green; new specs in `leases.service.spec.ts`
      covering transitions and authorization paths.

## 12. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/owner --filter=@repo/tenant`.
2. Sign in as `owner1@example.com`. Open Sunnyside → Units → A1 (occupied seed).
3. Open the existing seed lease on A1 (from `packages/db/src/seed.ts`).
4. Sign in (different browser / tab) as `tenant1@example.com` → `/my-leases`
   → see the same lease, read-only.
5. As owner: create a new draft lease for unit `B1` (vacant) → `tenant3@example.com`,
   rent 5,000,000 VND, deposit 5,000,000 VND, startDate today.
6. Activate the lease → unit `B1` flips to OCCUPIED in the units list.
7. Tenant3 logs in → `/my-leases` shows the new lease.
8. As owner: terminate the lease with reason "manual test" → unit `B1` goes
   back to VACANT.

## 13. Rollout

- One forward-only Prisma migration adding `Lease.terminationReason`.
- No feature flag.
- No backfill needed (existing seed leases get null `terminationReason`).
- No comms.
