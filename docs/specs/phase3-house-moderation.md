# Spec: House moderation queue (phase 3.4b)

> Status: **implemented (sans Playwright e2e)**
> Phase: 3
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Phase 3.4a gave admins a way to act on bad **users** (suspend, KYC). The other
half of "running the platform" is acting on bad **listings** — a house with
fake photos, a hidden hostel-style 20-bed conversion, or just a half-finished
draft that should never have been published. Phase 4 turns houses into
campaigns visible to prospects, so we need a moderation lane in place
_before_ that surface exists.

This slice ships the minimum: a queue admins can scan, a flag/reject mutation
with paired audit entries, and visibility to owners so they know what was
decided and why.

## 2. User stories

- As an **admin**, I want to browse every house on the platform filtered by
  moderation state so I can spot ones that need attention.
- As an **admin**, I want to flag a house (with a reason) so it's clearly
  marked for the owner to fix without blocking them outright.
- As an **admin**, I want to reject a house permanently (with a reason) so
  it stops being published and stays hidden from Phase 4 listings.
- As an **admin**, I want to clear a flag once the owner has addressed it
  so the house returns to normal.
- As an **owner**, I want to see the moderation status + reason on my own
  house detail so I know what to fix without contacting support.

## 3. Screens / surfaces

| Surface            | App   | Route          | Notes                                             |
| ------------------ | ----- | -------------- | ------------------------------------------------- |
| Houses queue       | admin | `/houses`      | Filter by status, owner, free-text search         |
| House detail       | admin | `/houses/[id]` | Full record + Flag / Clear / Reject actions       |
| Landing            | admin | `/`            | New tile linking to the queue                     |
| Owner house detail | owner | `/houses/[id]` | Banner showing current moderation status + reason |

## 4. API shape

```ts
// @repo/shared/schemas/houses.ts — extend houseSchema
moderationStatus: houseModerationStatusSchema,        // OK | FLAGGED | REJECTED
moderationReason: z.string().max(500).nullable(),
moderationDecidedAt: isoDateTimeSchema.nullable(),
moderationDecidedBy: idSchema.nullable(),
```

```ts
// @repo/shared/schemas/admin.ts (or admin-houses.ts)
export const listAdminHousesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  ownerId: idSchema.optional(),
  moderationStatus: houseModerationStatusSchema.optional(),
});

export const flagHouseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const clearHouseModerationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const rejectHouseSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
```

### Endpoints (all ADMIN)

| Method | Path                          | Description                                |
| ------ | ----------------------------- | ------------------------------------------ |
| GET    | `/v1/admin/houses`            | Paginated, filterable                      |
| GET    | `/v1/admin/houses/:id`        | Single house full detail                   |
| POST   | `/v1/admin/houses/:id/flag`   | `{ reason }` → status `FLAGGED`            |
| POST   | `/v1/admin/houses/:id/clear`  | `{ reason }` → status `OK`                 |
| POST   | `/v1/admin/houses/:id/reject` | `{ reason }` → `REJECTED` + auto-unpublish |

Owner side: no new endpoint. The existing `GET /v1/houses/:id` simply
includes the new moderation fields, so the owner sees the same state.

## 5. Data model changes

```prisma
enum HouseModerationStatus {
  OK
  FLAGGED
  REJECTED
}

model House {
  // ... existing fields ...

  moderationStatus    HouseModerationStatus @default(OK)
  moderationReason    String?               @db.VarChar(500)
  moderationDecidedAt DateTime?
  /// Admin user id at decision time. Frozen — admin user lookup happens on
  /// read if a name is needed (rare in v1).
  moderationDecidedBy String?

  @@index([moderationStatus, createdAt])
}
```

Migration name: `house_moderation`. Additive only — default `OK` covers every
existing row.

## 6. Workers / jobs

None. No notifications on flag/reject in v1 — the owner finds out on their
next visit to the house detail page. (Comms is a Phase 5 polish.)

## 7. Permissions

- **ADMIN**: all moderation reads + mutations.
- **OWNER**: sees moderation fields on their own houses (read-through on
  the existing `/v1/houses/:id`). No moderation mutations.
- **TENANT / PARTNER**: no access. Houses don't surface to tenants until
  Phase 4 (campaigns) anyway.
- **Admin acting on a house they happen to own** (rare): allowed. Houses
  are not personal data in the way user accounts are — no
  `cannot_act_on_self` guard.

## 8. Audit log

Every mutation writes one row in the same `$transaction` as the change.

| Action         | Target       | Meta keys                                                            |
| -------------- | ------------ | -------------------------------------------------------------------- |
| `house.flag`   | `House:<id>` | `reason` (string), `previousStatus` (HouseModerationStatus)          |
| `house.clear`  | `House:<id>` | `reason` (string), `previousStatus`, `previousReason` (string\|null) |
| `house.reject` | `House:<id>` | `reason` (string), `previousStatus`, `wasPublished` (bool)           |

IP and UA come from the request like the user-moderation flow. Actor is
the authenticated admin.

## 9. Edge cases

- **Already in target state** (e.g. flagging an already-FLAGGED house) →
  `409 admin.house_already_in_state`. The unique state-check shape matches
  the user-moderation 409 so the admin UI can use the same handler.
- **Soft-deleted house** → 404 on every admin endpoint.
- **Rejecting an unpublished house** → still flips `moderationStatus`;
  `isPublished` is already false so the auto-unpublish is a no-op (still
  recorded in audit meta as `wasPublished: false`).
- **Clearing an `OK` house** → 409 (no-op).
- **Reject reason required** — Zod rejects empty string with
  `VALIDATION_FAILED`.
- **Owner reads** — moderation fields are included in their normal house
  payload; nothing to gate.

## 10. Out of scope

- **User-initiated reports** — needs a `Report` table + flow. Phase 5+.
- **Owner appeals / response thread** — needs notification infra. Later.
- **Notifications to owner on flag** — Phase 5 (Resend + push wiring).
- **Auto-flagging** (ML, heuristics, keyword filters) — much later.
- **Unit-level moderation** — every problem we've discussed is house-level.
- **Bulk actions** — single-row UI for v1, same as user moderation.
- **Campaign moderation** — different domain, lands in Phase 4 alongside
  campaigns.

## 11. Acceptance criteria

- [x] Admin GETs `/v1/admin/houses` → paginated list, supports
      `moderationStatus`, `ownerId`, and `q` filters.
- [x] Admin POSTs `/flag` → `moderationStatus` flips to `FLAGGED`, reason
      is stored, audit row written in the same transaction.
- [x] Admin POSTs `/reject` on a published house → status flips to
      `REJECTED`, `isPublished` flips to `false`, audit row records the
      pre-state.
- [x] Admin POSTs `/clear` → status back to `OK`, reason cleared, audit
      row written.
- [x] Acting on a house that is already in the target state →
      `409 admin.house_already_in_state`.
- [x] Non-admin (owner / tenant / partner) on any `/v1/admin/houses*`
      route → `403 auth.role_mismatch` (covered globally by `RolesGuard`).
- [x] Owner GET on their own house → response includes
      `moderationStatus`, `moderationReason`, `moderationDecidedAt`,
      `moderationDecidedBy`.
- [x] Migration applies cleanly on a fresh DB; every existing row defaults
      to `OK`.

Playwright happy-path test deferred — `apps/e2e` is still unscaffolded,
matching the rest of Phase 3. Coverage held by the 9-case
`admin-houses.service.spec.ts` suite.

## 12. Manual test plan

1. `pnpm db:migrate:dev --name house_moderation`, then
   `pnpm turbo dev --filter=@repo/api --filter=@repo/admin --filter=@repo/owner`.
2. As admin, open `/houses` → see the seeded houses, all `OK`.
3. Open one house → "Flag" → enter "missing photos" → confirm.
4. As owner1 in another tab, open the same house → see the orange
   "FLAGGED" banner with the reason.
5. As admin, "Clear" with reason "owner uploaded photos" → owner banner
   disappears on refresh.
6. Admin "Reject" on a published house → confirm `isPublished=false` in
   the API response and that the house disappears from the public Phase 4
   feed (placeholder for now).
7. `/audit-log?action=house.` → see the three entries newest first.

## 13. Rollout

- No feature flag. Additive surface.
- Migration is additive and safe to apply ahead of code (default `OK`).
- Backfill: none.
- Comms: changelog note ("admin can now flag and reject listings").
