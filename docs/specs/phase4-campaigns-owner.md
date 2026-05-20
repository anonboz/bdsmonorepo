# Spec: Campaigns — owner CRUD + moderation submission (phase 4.1)

> Status: **implemented (sans Playwright e2e)**
> Phase: 4
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Phase 4 turns vacant units into a marketplace: owners post a campaign,
admins moderate, prospects apply, acceptance creates a lease. This
slice (4.1) is the foundation — everything the owner needs to author
a listing and hand it to admin review. Admin moderation (4.2), public
feed (4.3), and applications (4.4) layer on top of the schema and
status machine landed here.

## 2. User stories

- As an **owner**, I want to draft a campaign on a vacant unit so
  I can iterate on the title / body / photos before anyone sees it.
- As an **owner**, I want to submit a draft for admin review so my
  unit can become a public listing.
- As an **owner**, I want to withdraw a pending submission so I can
  fix something I noticed after submitting.
- As an **owner**, I want to close a live campaign so the unit stops
  collecting applications when I've found my tenant.
- As an **owner**, I want to see the rejection reason on a rejected
  campaign so I know what to fix before re-submitting.

## 3. Screens / surfaces

| Surface           | App   | Route                                                     | Notes                        |
| ----------------- | ----- | --------------------------------------------------------- | ---------------------------- |
| Campaigns list    | owner | `/houses/[id]/units/[unitId]/campaigns`                   | Per-unit list                |
| New campaign      | owner | `/houses/[id]/units/[unitId]/campaigns/new`               | Form                         |
| Campaign detail   | owner | `/houses/[id]/units/[unitId]/campaigns/[campaignId]`      | Includes transition actions  |
| Edit (DRAFT only) | owner | `/houses/[id]/units/[unitId]/campaigns/[campaignId]/edit` | Reuses the new-campaign form |

No tenant- or admin-side UI in this slice. Admin moderation lives in 4.2,
public feed in 4.3.

## 4. API shape

```ts
// @repo/shared/schemas/campaigns.ts
export const campaignSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  unitId: idSchema,
  /** Denormalized for owner-side filtering + breadcrumbs. */
  houseId: idSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  price: z.number().int().nonnegative(),
  currency: currencySchema,
  photos: z.array(z.string().url()).max(20),
  status: campaignStatusSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  moderationReason: z.string().max(500).nullable(),
  moderationDecidedAt: isoDateTimeSchema.nullable(),
  moderationDecidedBy: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createCampaignSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  price: z.number().int().nonnegative(),
  currency: currencySchema,
  photos: z.array(z.string().url()).max(20).default([]),
  expiresAt: isoDateTimeSchema.optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial();

/**
 * Owner-side transitions. Admin transitions (PENDING → LIVE / REJECTED)
 * land in 4.2 with their own schema; keeping them split makes the
 * permission gate trivial.
 */
export const transitionCampaignSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('PENDING') }), // DRAFT → PENDING (submit)
  z.object({ to: z.literal('DRAFT') }), // PENDING → DRAFT (withdraw)
  z.object({ to: z.literal('CLOSED') }), // LIVE → CLOSED  (close)
]);

export const listCampaignsQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusSchema.optional(),
});
```

### Endpoints (all owner-scoped — nested under units)

| Method | Path                                                   | Description                        |
| ------ | ------------------------------------------------------ | ---------------------------------- |
| POST   | `/v1/houses/:hid/units/:uid/campaigns`                 | Create DRAFT                       |
| GET    | `/v1/houses/:hid/units/:uid/campaigns`                 | List campaigns on the unit         |
| GET    | `/v1/houses/:hid/units/:uid/campaigns/:id`             | Single campaign                    |
| PATCH  | `/v1/houses/:hid/units/:uid/campaigns/:id`             | Update — DRAFT only                |
| POST   | `/v1/houses/:hid/units/:uid/campaigns/:id/transitions` | submit / withdraw / close          |
| DELETE | `/v1/houses/:hid/units/:uid/campaigns/:id`             | Soft-delete — DRAFT or CLOSED only |

## 5. Data model changes

```prisma
model Campaign {
  // ... existing fields ...

  /// Denormalized from `unit.house.ownerId` so we can index queries
  /// by owner without joining. Frozen on create — re-issuing the
  /// campaign under a new owner is out of scope.
  ownerId String

  photos String[] @default([])

  moderationReason    String?   @db.VarChar(500)
  moderationDecidedAt DateTime?
  moderationDecidedBy String?

  @@index([ownerId, status])
}
```

Migration: `campaign_owner_and_moderation`. The Campaign table is
empty (no rows have been written to it yet), so `ownerId` can land
as NOT NULL without a backfill.

## 6. Workers / jobs

None in this slice. Expiry (`LIVE` → `EXPIRED` when `expiresAt < now`)
gets a BullMQ sweeper in 4.3 when the public feed needs accurate
freshness; for now the owner controls expiry by closing.

## 7. Permissions

- **OWNER** of the parent house — full CRUD on campaigns under their
  own units. All routes return 404 (not 403) on cross-owner access
  to match the existence-hiding pattern from `leases` and `houses`.
- **ADMIN** — read any campaign via the existing admin path. No
  mutations in 4.1; queue actions land in 4.2.
- **TENANT / PARTNER** — no access until 4.3.

## 8. State machine (owner-side only)

```
            ┌── submit ─────►─┐
            │                 │
        ┌─DRAFT◄── withdraw ──PENDING ── (admin) ─► LIVE ── close ─► CLOSED
            │                 │
            └── (admin) ────► REJECTED
                              │
                              └── (re-submit) → PENDING
```

This slice ships only the **owner arrows**: `DRAFT → PENDING`,
`PENDING → DRAFT`, `LIVE → CLOSED`. The admin arrows + re-submit
flow are 4.2.

Source of truth: a `CAMPAIGN_TRANSITIONS` map in the service, mirroring
`ALLOWED_TRANSITIONS` in `leases.service.ts`.

## 9. Validation

- **Create / update** — unit must exist, be owned by the actor,
  not soft-deleted; price ≥ 0; currency present; ≤ 20 photo URLs.
- **Submit (DRAFT → PENDING)** — unit must be VACANT and no other
  campaign on the same unit may be in `LIVE`. (Two DRAFTs are fine.)
- **Update / delete** — only allowed on DRAFT or CLOSED campaigns.
- **Close (LIVE → CLOSED)** — always allowed by the owner.

## 10. Audit log

Each owner transition writes one row through the existing AuditLogger
inside the same `$transaction` as the status update:

| Action              | Target          | Meta keys                             |
| ------------------- | --------------- | ------------------------------------- |
| `campaign.submit`   | `Campaign:<id>` | `previousStatus`, `unitId`, `houseId` |
| `campaign.withdraw` | `Campaign:<id>` | `previousStatus`, `unitId`, `houseId` |
| `campaign.close`    | `Campaign:<id>` | `previousStatus`, `unitId`, `houseId` |

`campaign.create` / `campaign.update` are intentionally NOT audited —
draft edits aren't sensitive enough (same rationale as `lease.create`
in 3.5).

## 11. Edge cases

- **Submitting while another campaign on the same unit is LIVE** →
  `409 campaign.unit_not_vacant`. Owner has to close the live one first.
- **Submitting while the unit is OCCUPIED** → same 409. Vacate the
  lease first (terminate / end).
- **Editing a non-DRAFT campaign** → `422 campaign.not_draft`.
- **Cross-owner access** → 404 `campaign.not_found`.
- **Soft-deleted campaign** → 404.
- **Re-submitting after a withdraw** → allowed, goes DRAFT → PENDING.
- **REJECTED campaign edits / re-submit** — DEFERRED to 4.2 once
  the admin side exists.

## 12. Out of scope

- **Admin moderation queue** — 4.2.
- **Public feed + tenant browse** — 4.3.
- **Application flow** — 4.4.
- **Expiry sweeper** — 4.3 (lives where freshness matters most).
- **Photo upload** — for v1 we store URL strings; an S3-backed upload
  endpoint comes later. The form takes a comma-separated URL list.
- **Pricing model / Stripe / commission** — Phase 5+.

## 13. Acceptance criteria

- [x] Owner POST creates a `DRAFT` campaign with `ownerId` denormalized
      from the unit's house.
- [x] Owner can PATCH a DRAFT but not any other status.
- [x] Owner submit (`DRAFT → PENDING`) succeeds when unit is VACANT
      and writes a `campaign.submit` audit row.
- [x] Submit fails with `409 campaign.unit_not_vacant` when another
      LIVE campaign exists on the same unit.
- [x] Owner withdraw (`PENDING → DRAFT`) succeeds + writes audit.
- [x] Owner close (`LIVE → CLOSED`) succeeds + writes audit.
- [x] DELETE allowed on DRAFT and CLOSED only; PENDING/LIVE returns 422.
- [x] Cross-owner GET returns 404.
- [x] All migrations apply cleanly; `ownerId` is NOT NULL.

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with Phase 3). Coverage held by the 12-case
`campaigns.service.spec.ts` suite.

## 14. Manual test plan

1. `pnpm db:migrate:dev --name campaign_owner_and_moderation`.
2. As owner1, navigate to a VACANT unit → "Campaigns" → "New" → submit
   form with title/body/price → see the new DRAFT.
3. Edit title → save → still DRAFT.
4. "Submit for review" → status flips to PENDING. Admin /audit-log
   shows the `campaign.submit` row.
5. As admin (manual SQL or future 4.2 UI): flip `status='LIVE'`,
   refresh owner — see the campaign in LIVE state.
6. "Close" → CLOSED + audit row.
7. Try to delete the LIVE one → 422.

## 15. Rollout

- No flag. No backfill (table is empty in dev + prod).
- Migration is additive; safe to apply ahead of code.
- Comms: dev changelog note.
