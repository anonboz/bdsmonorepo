# Spec: Lease ratings (phase 3.3)

> Status: **implemented (sans Playwright e2e)**
> Phase: 3
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Owners and tenants pick each other partly on reputation. Without ratings, every
counterparty is a cold lead, and a "good tenant who pays on time" or "owner
who actually fixes things" has no way to signal that. We want a low-friction
1–5 star + optional comment, scoped to specific lease milestones so the rater
has a clear reason to write right then ("you just moved in — how's the
place?") instead of an abstract "rate this person any time."

Closes the tenant ↔ owner trust loop opened in phases 2 (leases/bills) and
3.1/3.2 (tickets + chat).

## 2. User stories

- As a **tenant**, I want to rate my owner at move-in, mid-lease, and move-out
  so future tenants know what to expect.
- As an **owner**, I want to rate my tenant at the same three points so future
  owners can vet applicants.
- As either party, I want to see ratings I have received so I know how I'm
  doing.
- As a **prospect** browsing campaigns (Phase 4), I want to see the owner's
  aggregate score on the listing. **Not built here** — Phase 4 surfaces this
  via the read endpoint we ship in this slice.

## 3. Screens / surfaces

| Surface                            | App    | Route                                                            | Notes                             |
| ---------------------------------- | ------ | ---------------------------------------------------------------- | --------------------------------- |
| Tenant lease detail — open prompts | tenant | `/my-leases/[leaseId]`                                           | One card per open milestone       |
| Tenant "my reputation"             | tenant | `/me/ratings`                                                    | List of ratings received          |
| Owner lease detail — open prompts  | owner  | `/houses/[id]/units/[unitId]/leases/[leaseId]`                   | One card per open milestone       |
| Owner "my reputation"              | owner  | `/me/ratings`                                                    | List of ratings received          |
| API tenant write                   | api    | `POST /v1/me/leases/:leaseId/ratings`                            |                                   |
| API owner write                    | api    | `POST /v1/houses/:houseId/units/:unitId/leases/:leaseId/ratings` |                                   |
| API self summary                   | api    | `GET /v1/me/ratings/summary`, `GET /v1/me/ratings`               |                                   |
| API public user summary            | api    | `GET /v1/users/:id/rating-summary`                               | Read-only; backs Phase 4 listings |

## 4. API shape

```ts
// @repo/shared/schemas/ratings.ts
export const ratingMilestoneSchema = z.enum(['MOVE_IN', 'MID_LEASE', 'MOVE_OUT']);
export const ratingDirectionSchema = z.enum(['TENANT_TO_OWNER', 'OWNER_TO_TENANT']);

export const leaseRatingSchema = z.object({
  id,
  leaseId,
  raterId,
  raterName,
  ratedId,
  ratedName,
  direction, // who rated who
  milestone, // which milestone window
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  createdAt,
});

export const createLeaseRatingSchema = z.object({
  milestone: ratingMilestoneSchema,
  score: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(2000).optional(),
});

export const ratingMilestoneStateSchema = z.object({
  milestone,
  opensAt: isoDateTimeSchema.nullable(),
  isOpen: z.boolean(),
  reason: z.string().nullable(),
  alreadyRated: z.boolean(),
});
// `GET /v1/me/leases/:id/rating-state?direction=TENANT_TO_OWNER` returns
// the three milestone rows so the UI knows which buttons to show.

export const userRatingSummarySchema = z.object({
  userId,
  average: z.number().nullable(),
  count: z.number().int().nonnegative(),
});
```

Endpoints:

| Method | Path                                                  | Role(s) | Description                                 |
| ------ | ----------------------------------------------------- | ------- | ------------------------------------------- |
| GET    | `/v1/me/leases/:id/rating-state`                      | TENANT  | Three rows: open / not / already rated      |
| POST   | `/v1/me/leases/:id/ratings`                           | TENANT  | Submit TENANT_TO_OWNER rating               |
| GET    | `/v1/houses/:hid/units/:uid/leases/:lid/rating-state` | OWNER   | Three rows                                  |
| POST   | `/v1/houses/:hid/units/:uid/leases/:lid/ratings`      | OWNER   | Submit OWNER_TO_TENANT rating               |
| GET    | `/v1/me/ratings`                                      | any     | Ratings received by current user (paged)    |
| GET    | `/v1/me/ratings/summary`                              | any     | `{ average, count }` for current user       |
| GET    | `/v1/users/:id/rating-summary`                        | any     | Public read for prospect / Phase 4 listings |

## 5. Data model changes

```prisma
enum RatingMilestone {
  MOVE_IN
  MID_LEASE
  MOVE_OUT
}

enum RatingDirection {
  TENANT_TO_OWNER
  OWNER_TO_TENANT
}

model LeaseRating {
  id        String   @id @default(cuid())
  leaseId   String
  lease     Lease    @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  raterId   String
  rater     User     @relation("RatingRater", fields: [raterId], references: [id], onDelete: Restrict)
  ratedId   String
  rated     User     @relation("RatingRated", fields: [ratedId], references: [id], onDelete: Restrict)
  direction RatingDirection
  milestone RatingMilestone
  score     Int      // 1..5; enforced by Zod at the boundary
  comment   String?  @db.VarChar(2000)

  createdAt DateTime @default(now())

  /// One rating per (lease, direction, milestone). Stops double-submit and
  /// makes "have I rated this?" a single index hit.
  @@unique([leaseId, direction, milestone])
  @@index([ratedId, createdAt])
  @@index([leaseId])
}
```

Plus on `Lease`: `ratings LeaseRating[]`.
Plus on `User`: `ratingsGiven LeaseRating[] @relation("RatingRater")`,
`ratingsReceived LeaseRating[] @relation("RatingRated")`.

Migration name: `lease_ratings`

## 6. Workers / jobs

None. Aggregates are computed on read — fast enough at our scale and avoids the
denormalization-drift class of bugs.

## 7. Permissions

- **TENANT** writes only `TENANT_TO_OWNER`, only on a lease where they are the
  named tenant.
- **OWNER** writes only `OWNER_TO_TENANT`, only on a lease they own.
- **No cross-rating** — a tenant who is also an owner on a different lease still
  only rates the lease where they are tenant.
- **Reads:** any authenticated user can read another user's summary (it's
  intentionally public-ish — prospects need it). Individual rating rows + raw
  comments are only visible to the rated party and to admins.
- Cross-party access → 404 (existence hiding, same as tickets).

### Milestone windows

| Milestone   | Opens                                                                                    | Notes                                                 |
| ----------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `MOVE_IN`   | `lease.startDate` (date-only ≤ today)                                                    | Open until rated; no upper bound.                     |
| `MID_LEASE` | `min(midpoint, startDate + 90d)`, where midpoint = halfway between startDate and endDate | If no endDate (open-ended lease) → `startDate + 90d`. |
| `MOVE_OUT`  | `lease.endDate` (if set) **or** when lease transitions to `ENDED` / `TERMINATED`         | Whichever comes first.                                |

A lease still in `DRAFT` has no open milestones.

## 8. Edge cases

- **Lease still DRAFT** — no rating-state rows are open.
- **No endDate set** — `MID_LEASE` falls back to `startDate + 90d`; `MOVE_OUT`
  opens only when lease.status flips to ENDED or TERMINATED.
- **Already rated** — 409 `RATING_ALREADY_GIVEN`. The state endpoint marks the
  row so the UI hides the prompt.
- **Closed-then-rated** — terminated leases still allow MOVE_OUT ratings; no
  expiry window in v1 (we may add one later to avoid stale grudge ratings).
- **Score 0 or > 5** rejected by Zod with `VALIDATION_FAILED`.
- **Display names** stored as joins on read (current name), like ticket
  messages. Comments are stored verbatim and never edited.
- **Author identity changes** — if a tenant becomes the new owner of the same
  house later (rare), historical ratings still attribute correctly via the
  frozen `raterId` / `ratedId`. Direction was decided at write time.

## 9. Out of scope

- Public per-house rating page (Phase 4 — uses the summary endpoint).
- Moderation / takedown of ratings (admin tooling in Phase 3.4b).
- Reply / dispute on a rating (Phase 3.5 — needs notifications and a flagging
  workflow).
- Aggregate breakdown by milestone, time series, or "verified renter" badges.
- Rating partners (the partner marketplace has its own `ServiceJob` rating
  flow — Phase 5).

## 10. Acceptance criteria

- [x] Tenant can submit a `MOVE_IN` rating once `startDate` has passed.
- [x] Owner can submit an `OWNER_TO_TENANT` rating at the same milestones.
- [x] Double-submit returns 409.
- [x] Cross-party POST returns 404.
- [x] DRAFT lease shows zero open milestones.
- [x] Open-ended lease (no endDate) opens `MID_LEASE` at `startDate + 90d`.
- [x] `MOVE_OUT` opens when status flips to `ENDED` even if `endDate` is null.
- [x] User summary endpoint returns `{ average, count }` and is callable
      without being the rated user.

Playwright happy-path test deferred — the `apps/e2e` harness is unscaffolded
(matches the rest of Phase 3). Coverage held by the 12-case
`ratings.service.spec.ts` suite plus the unit tests in adjacent slices.

## 11. Manual test plan

1. As owner: activate a lease with startDate = today, no endDate.
2. As tenant on that lease: open `/my-leases/[id]` → see one open prompt
   (MOVE_IN) → submit 5 stars + comment.
3. Owner side: open the lease → see one open prompt (MOVE_IN) → submit 4
   stars.
4. As tenant: open `/me/ratings` → see the 4 stars the owner gave.
5. As anyone: GET `/v1/users/:tenantId/rating-summary` → `{ average: 4, count: 1 }`.
6. Try POSTing MOVE_OUT before the lease ends → 422 `RATING_MILESTONE_LOCKED`.
7. Try double-submitting MOVE_IN → 409 `RATING_ALREADY_GIVEN`.
8. As another tenant: POST on the same lease → 404.

## 12. Rollout

- No flag. Additive surface.
- Migration is additive — safe to apply ahead of code.
- Backfill: none. Existing leases have zero ratings; users can opt in.
- Comms: mention in changelog ("you can now rate your owner / tenant").
