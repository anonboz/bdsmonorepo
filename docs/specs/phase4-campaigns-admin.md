# Spec: Campaigns — admin moderation queue (phase 4.2)

> Status: **implemented (sans Playwright e2e)**
> Phase: 4
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

4.1 gave owners a draft → submit pipeline that parks campaigns in
`PENDING`. Nothing moves them forward — admins need a queue to approve
or reject those submissions before 4.3 starts showing campaigns to the
public. The owner side also needs a recovery arrow: a rejected campaign
should be editable + re-submittable so we don't force the owner to
start a fresh draft for every typo.

## 2. User stories

- As an **admin**, I want a paged queue of PENDING campaigns so I can
  review the moderation backlog at a glance.
- As an **admin**, I want to approve a PENDING campaign so it goes
  LIVE and `publishedAt` is recorded.
- As an **admin**, I want to reject with a reason so the owner knows
  what to fix.
- As an **owner**, I want to edit a REJECTED campaign and re-submit
  it so I don't have to recreate the listing from scratch.

## 3. Screens / surfaces

| Surface         | App   | Route             | Notes                                 |
| --------------- | ----- | ----------------- | ------------------------------------- |
| Campaigns queue | admin | `/campaigns`      | Filter by status (default PENDING)    |
| Campaign detail | admin | `/campaigns/[id]` | Approve / Reject actions              |
| Landing         | admin | `/`               | New "Campaigns" tile linking to queue |

Owner-side changes are additive:

- Detail page already showed the REJECTED banner from 4.1; the Edit
  button now appears in REJECTED status (not just DRAFT) and a
  "Re-submit" action appears.

## 4. API shape

```ts
// @repo/shared/schemas/admin.ts — new schemas
export const listAdminCampaignsQuerySchema = paginationQuerySchema.extend({
  status: campaignStatusSchema.optional(),
  ownerId: idSchema.optional(),
  q: z.string().trim().max(100).optional(), // title / city substring
});

export const approveCampaignSchema = z.object({}).strict(); // no body
export const rejectCampaignSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
```

### Endpoints (all ADMIN)

| Method | Path                              | Description                               |
| ------ | --------------------------------- | ----------------------------------------- |
| GET    | `/v1/admin/campaigns`             | Paginated, filterable                     |
| GET    | `/v1/admin/campaigns/:id`         | Single campaign full detail               |
| POST   | `/v1/admin/campaigns/:id/approve` | `{}` → `LIVE` + `publishedAt = now`       |
| POST   | `/v1/admin/campaigns/:id/reject`  | `{ reason }` → `REJECTED` + stores reason |

### Owner side — extended

| Method | Path                                                                  | Change                                             |
| ------ | --------------------------------------------------------------------- | -------------------------------------------------- |
| PATCH  | `/v1/houses/:hid/units/:uid/campaigns/:id`                            | Now allowed in `REJECTED` (in addition to `DRAFT`) |
| POST   | `/v1/houses/:hid/units/:uid/campaigns/:id/transitions` `{to:PENDING}` | Now accepted from `REJECTED` (re-submit)           |

## 5. Data model changes

None. 4.1 already added `moderationReason / DecidedAt / DecidedBy`.

When transitioning into `PENDING` (from DRAFT _or_ REJECTED) the
service clears `moderationReason / DecidedAt / DecidedBy` so a stale
rejection reason doesn't leak into the next review cycle.

When approving (`PENDING → LIVE`), the service also sets
`publishedAt = now()`. We do _not_ set it on re-publish from LIVE
(no such transition exists).

## 6. State machine (post-4.2)

```
        ┌── submit ────►─┐
        │                │
DRAFT◄── withdraw ──PENDING ── approve (admin) ─► LIVE ── close ─► CLOSED
        ▲                │
        │                └── reject (admin) ──► REJECTED ─┐
        │                                                  │
        └──────────────── (clear or edit + re-submit) ◄────┘
```

`OWNER_TRANSITIONS` (post-4.2):

```
DRAFT     → PENDING
PENDING   → DRAFT
LIVE      → CLOSED
REJECTED  → PENDING        ← new in 4.2
CLOSED    → (none)
EXPIRED   → (none)
```

`ADMIN_TRANSITIONS` (new):

```
PENDING   → LIVE
PENDING   → REJECTED
```

The admin verbs live on the admin controller; the owner verbs on the
owner controller. Each side checks its own map; cross-side transitions
return `422 admin.campaign_not_pending` / owner equivalents.

## 7. Permissions

- **ADMIN** — all reads + approve/reject on PENDING.
- **OWNER** — unchanged for 4.2; gains REJECTED edits + re-submit.
- **TENANT / PARTNER** — still no access until 4.3.

## 8. Audit log

| Action             | Target          | Meta keys                                                | Actor |
| ------------------ | --------------- | -------------------------------------------------------- | ----- |
| `campaign.approve` | `Campaign:<id>` | `previousStatus` (always `PENDING`), `unitId`, `houseId` | admin |
| `campaign.reject`  | `Campaign:<id>` | `previousStatus`, `reason`, `unitId`, `houseId`          | admin |

Each admin mutation runs inside the same `$transaction` as the audit
write, mirroring the user / house moderation pattern.

The existing 4.1 owner action codes (`campaign.submit` /
`campaign.withdraw` / `campaign.close`) remain unchanged.

## 9. Edge cases

- **Approve / reject on a non-PENDING campaign** →
  `422 admin.campaign_not_pending`.
- **Reject without a reason** — rejected by Zod with
  `VALIDATION_FAILED`.
- **Approve while the unit is OCCUPIED** — the campaign's _unit_
  might have been leased between submit and approval. Admin still
  approves; the owner is expected to close the campaign manually if
  the unit no longer matches. (Same trade-off as house moderation:
  admin acts on the artefact, not the world it lives in.)
- **Soft-deleted campaign** → 404 on every admin endpoint.
- **Cross-side transition** (e.g. owner attempting `PENDING → LIVE`)
  → owner's `CAMPAIGN_INVALID_TRANSITION` (admin verb isn't in
  `OWNER_TRANSITIONS`).
- **REJECTED re-submit** clears `moderationReason / DecidedAt / DecidedBy`
  before the new review. Audit row for the re-submit (`campaign.submit`)
  still records the previous status as `REJECTED`.

## 10. Out of scope

- **Public feed** — 4.3 lights up `LIVE` campaigns for prospects.
- **Application flow** — 4.4.
- **Auto-expiry** — sweeper still deferred to 4.3.
- **Bulk approve / reject** — single-row UI for v1.

## 11. Acceptance criteria

- [x] `GET /v1/admin/campaigns?status=PENDING` returns the queue.
- [x] Admin POST `/approve` on PENDING flips to `LIVE`, sets
      `publishedAt`, writes `campaign.approve` audit row atomically.
- [x] Admin POST `/reject` on PENDING flips to `REJECTED`, stores
      `moderationReason`, writes `campaign.reject` audit row.
- [x] Approve / reject on non-PENDING → `422 admin.campaign_not_pending`.
- [x] Owner PATCH on REJECTED succeeds; on PENDING / LIVE / CLOSED /
      EXPIRED returns 422.
- [x] Owner re-submit (`REJECTED → PENDING`) succeeds, clears the
      moderation\* fields, writes a `campaign.submit` row with
      `previousStatus: 'REJECTED'`.
- [x] Non-admin on `/v1/admin/campaigns*` → `403 auth.role_mismatch`
      (RolesGuard).

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with the rest of Phase 4). Coverage held by the 6 new
cases in `campaigns.service.spec.ts` (18 total).

## 12. Manual test plan

1. As owner1, submit a campaign (left in PENDING).
2. As admin, open `/campaigns?status=PENDING` → see the row.
3. Click the row → reject with reason "no photos" → status flips to
   REJECTED. Audit log shows the row.
4. As owner1, open the campaign → see the rejection banner → edit →
   add a photo URL → re-submit → status PENDING.
5. Admin queue refreshes → approve → status LIVE, `publishedAt` set.
6. (Out of scope, sanity check) `GET /v1/admin/campaigns` returns the
   approved one with the new status.

## 13. Rollout

- No flag. No migration. Pure additive surface.
- Comms: dev changelog note.
