# Spec: units (Phase 2.1)

> Status: **draft**
> Phase: 2
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

An owner needs to break a house into rentable sub-rooms (units). Units are the
join point between a house and the people renting it — leases attach to units,
not houses; bills and tickets attach to leases; so without units we can't ship
the rest of Phase 2 (leases → bills → payments).

## 2. User stories

- As an **owner**, I want to add units to a house with a label and basic stats
  so I can track availability per room.
- As an **owner**, I want to mark a unit's status (vacant / occupied /
  maintenance) so my dashboard reflects what's rentable.
- As an **owner**, I want to edit a unit's stats and rename its label so I can
  fix typos and reflect renovations.
- As an **owner**, I want to soft-delete a unit, but only if no active lease
  references it, so I don't accidentally orphan a tenant's lease.

Tenants and partners do not read units directly in this slice — they see
units transitively via leases (Phase 2.2) and tickets (Phase 3).

## 3. Screens

| Surface             | App   | Route                              | Notes                                      |
| ------------------- | ----- | ---------------------------------- | ------------------------------------------ |
| Unit list           | owner | `/houses/[id]/units`               | Cards w/ label, status badge, bed/bath/sqm |
| New unit            | owner | `/houses/[id]/units/new`           | Shared `UnitForm`                          |
| Unit detail         | owner | `/houses/[id]/units/[unitId]`      | Stats + edit/delete + (later) leases card  |
| Edit unit           | owner | `/houses/[id]/units/[unitId]/edit` | Shared `UnitForm` (pre-filled)             |
| House detail update | owner | `/houses/[id]`                     | Replace Phase-1 placeholder with units CTA |

## 4. API shape

Nested under the house for clarity:

```ts
// @repo/shared/schemas/units.ts
export const unitSchema = z.object({
  id: idSchema,
  houseId: idSchema,
  label: z.string().min(1).max(60),
  status: unitStatusSchema, // VACANT | OCCUPIED | MAINTENANCE
  floor: z.number().int().nullable(),
  sqm: z.number().int().positive().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: z.number().int().nonnegative().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createUnitSchema = z.object({
  label: z.string().min(1).max(60),
  status: unitStatusSchema.default('VACANT'),
  floor: z.number().int().optional(),
  sqm: z.number().int().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
});

export const updateUnitSchema = createUnitSchema.partial();

export const listUnitsQuerySchema = paginationQuerySchema.extend({
  status: unitStatusSchema.optional(),
});
```

Endpoints (all require `@Roles('OWNER')` plus implicit House ownership):

| Method | Path                            | Description        |
| ------ | ------------------------------- | ------------------ |
| POST   | `/v1/houses/:houseId/units`     | create a unit      |
| GET    | `/v1/houses/:houseId/units`     | list units (paged) |
| GET    | `/v1/houses/:houseId/units/:id` | get one unit       |
| PATCH  | `/v1/houses/:houseId/units/:id` | update             |
| DELETE | `/v1/houses/:houseId/units/:id` | soft-delete        |

ADMIN can also GET (read-any). Mutations are owner-only — admin moderation
endpoints land in Phase 3.

## 5. Data model changes

`Unit` is already in `packages/db/prisma/schema.prisma` from Phase 1.2 — no
schema migration needed for this slice. The `@@unique([houseId, label])`
constraint already gives us the "label taken" 409 case.

## 6. Workers / jobs

None.

## 7. Permissions

- Owner of the parent House: full CRUD on its units.
- Other owners: 404 (not 403) — same existence-hiding policy as houses.
- ADMIN: read-only in this slice.
- TENANT, PARTNER: no access.

## 8. Edge cases

- **Soft-delete with active lease** → 409 `unit.has_active_lease` with the
  count of active leases attached. (DRAFT leases also block — they may be
  in flight.)
- **Duplicate label within the same house** → 409 `unit.label_taken` (caught
  via Prisma's P2002 on `@@unique([houseId, label])`).
- **Unit referenced from another owner's house** → 404; the service resolves
  the House first and applies ownership before touching units.
- **Status transition into VACANT while a lease is ACTIVE** → allowed in this
  slice (no state machine yet); a follow-up in Phase 2.2 will couple this
  with lease lifecycle.

## 9. Out of scope

- **Photos** — the BUILD_PLAN lists "photos to object storage" under this
  task. Deferred to **Phase 2.1b** because we don't have an object store
  wired yet (S3/MinIO/Supabase Storage decision pending — see open decision
  log). Tracking issue: TBD.
- **Bulk unit creation** (e.g. "create A1–A8 in one shot"). Not in Phase 2.
- **Floor plans / amenities** beyond bedrooms/bathrooms/sqm.

## 10. Acceptance criteria

- [ ] Owner POSTs a unit → appears in list → GETs it → PATCHes it → DELETEs
      it (with empty-leases precondition); all five round-trip via the UI.
- [ ] Owner of a different house gets 404 trying to read or mutate someone
      else's unit.
- [ ] Tenant cookie on `/v1/houses/:id/units*` → 403 `auth.role_mismatch`.
- [ ] Creating a unit with a duplicate label in the same house → 409
      `unit.label_taken`.
- [ ] Deleting a unit that has an active lease (when leases land in 2.2) →
      409 `unit.has_active_lease`.
- [ ] All 33 turbo tasks stay green; new unit unit-spec in
      `apps/api/src/units/units.service.spec.ts`.

## 11. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/owner`.
2. Sign in as `owner1@example.com` in the owner app.
3. Open Sunnyside Apartments → click "Units" → existing seed units A1/A2/B1/B2
   render with status badges.
4. Click "New unit", fill label `C1`, status `VACANT`, bedrooms 2 → submit.
5. Verify the new unit appears in the list.
6. Edit `C1` → change bedrooms to 3 → save → detail page shows updated stats.
7. Try to delete A1 (occupied seed unit) → expect a clear error in the UI
   once Phase 2.2 leases land. For now: delete C1 → list refreshes.
8. Try to create another `C1` → expect an error toast about duplicate label.

## 12. Rollout

- No feature flag.
- No backfill.
- No migration.
- No comms; internal-only surface during Phase 2 build-out.
