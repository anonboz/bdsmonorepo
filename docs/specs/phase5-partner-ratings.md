# Spec: Partner ratings + discovery ranking (phase 5.5)

> Status: **implemented (sans Playwright e2e)**
> Phase: 5
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

5.2 — 5.4 ship the end-to-end booking + payout flow but every partner
in the directory looks the same to a browsing owner. 5.5 closes the
Phase 5 acceptance with reputation: after a job is `COMPLETED`, owner
and partner each rate the other 1–5 stars with an optional comment;
the partner directory then orders by rating so future bookings reward
proven providers.

Lease-side ratings already exist (Phase 3.3, `LeaseRating`). Job
ratings mirror their patterns but are simpler — no milestones, one
rating per direction per completed job.

## 2. User stories

- As an **owner** with a completed job, I want to rate the partner so
  others can find reliable providers.
- As a **partner** with a completed job, I want to rate the owner so
  fellow partners know whether they pay on time.
- As either party, I want to see what the other side said about me on
  this job so I can learn from it.
- As a **browsing owner**, I want partners with strong reputations to
  show up first in the directory.

## 3. Screens / surfaces

| Surface            | App     | Route                   | Notes                                         |
| ------------------ | ------- | ----------------------- | --------------------------------------------- |
| Owner job detail   | owner   | `/me/service-jobs/[id]` | Rate-partner card on COMPLETED; partner's     |
|                    |         |                         | own rating shown once written                 |
| Partner job detail | partner | `/jobs/[id]`            | Same shape, opposite direction                |
| Partners browse    | owner   | `/partners`             | Card shows ★ avg + count; default sort by avg |
| Partner detail     | owner   | `/partners/[id]`        | ★ avg + count near the business name          |

## 4. API shape

```ts
// @repo/shared/schemas/job-ratings.ts
export const jobRatingDirectionSchema = z.enum(['OWNER_TO_PARTNER', 'PARTNER_TO_OWNER']);

export const jobRatingSchema = z.object({
  id: idSchema,
  jobId: idSchema,
  raterId: idSchema,
  raterName: z.string(),
  ratedId: idSchema,
  ratedName: z.string(),
  direction: jobRatingDirectionSchema,
  score: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
});

export const createJobRatingSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(2000).optional(),
});

export const jobRatingsForJobSchema = z.object({
  ownerToPartner: jobRatingSchema.nullable(),
  partnerToOwner: jobRatingSchema.nullable(),
});
```

`partnerSummarySchema` (Phase 5.1) gains two fields:

```ts
ratingAverage: z.number().nullable(),   // 1..5; null if no ratings
ratingCount: z.number().int().nonnegative(),
```

### Endpoints

**Owner** (`@Roles('OWNER')`):

| Method | Path                              | Description                               |
| ------ | --------------------------------- | ----------------------------------------- |
| POST   | `/v1/me/service-jobs/:id/rating`  | `{ score, comment? }` → rates the partner |
| GET    | `/v1/me/service-jobs/:id/ratings` | Both directions for this job              |

**Partner** (`@Roles('PARTNER')`):

| Method | Path                      | Description                             |
| ------ | ------------------------- | --------------------------------------- |
| POST   | `/v1/me/jobs/:id/rating`  | `{ score, comment? }` → rates the owner |
| GET    | `/v1/me/jobs/:id/ratings` | Both directions for this job            |

`partnerSummarySchema` is the existing read on `/v1/partners` +
`/v1/partners/:id`; the two new fields appear inline.

## 5. Data model

```prisma
enum JobRatingDirection {
  OWNER_TO_PARTNER
  PARTNER_TO_OWNER
}

model JobRating {
  id        String              @id @default(cuid())
  jobId     String
  job       ServiceJob          @relation(fields: [jobId], references: [id], onDelete: Cascade)
  raterId   String
  rater     User                @relation("JobRatingRater", fields: [raterId], references: [id], onDelete: Restrict)
  ratedId   String
  rated     User                @relation("JobRatingRated", fields: [ratedId], references: [id], onDelete: Restrict)
  direction JobRatingDirection
  score     Int                 // 1..5; enforced by Zod at the boundary
  comment   String?             @db.VarChar(2000)
  createdAt DateTime            @default(now())

  /// One rating per (job, direction). Stops double-submit and makes
  /// "have I rated this?" a single index hit.
  @@unique([jobId, direction])
  @@index([ratedId, createdAt])
  @@index([jobId])
}
```

Migration name: `job_ratings`. Empty table — additive only.

## 6. Job status

We do **not** transition `COMPLETED → RATED` in this slice. Lease
ratings (3.3) similarly leave lease state alone, and the auto-flip
introduces coordination edge cases ("what if one side never rates?").
The `RATED` enum value stays in `JobStatus` for a future polish that
auto-flips when both directions have ratings.

## 7. Workers / jobs

None. Aggregates computed on read, same as lease ratings.

## 8. Discovery ranking

`PartnersService.listPublic` (Phase 5.1) gets a richer query:

1. Find non-suspended, non-deleted partners.
2. Aggregate the partner's user-level rating average + count via
   `prisma.jobRating.aggregate({ where: { ratedId, ... } })` per row.
3. **Default sort**: `ratingAverage DESC NULLS LAST`, then
   `createdAt DESC`. Partners with no ratings still appear, but after
   any rated partner.
4. The same aggregation feeds `getPublic` for the detail page.

Cursor pagination still works against the same secondary `id` ordering;
the rating average is a deterministic per-row value so re-fetching is
stable across pages.

## 9. Permissions

- **OWNER** of the job (`ownerId`): may POST `OWNER_TO_PARTNER`. May
  read both directions for jobs they own. Cross-owner → 404.
- **PARTNER** assigned to the job: may POST `PARTNER_TO_OWNER`. May
  read both directions for jobs assigned to them.
- **Tenant / Admin**: not in this slice. Admin moderation of ratings
  (takedown) is a later concern.
- **No rating before COMPLETED** → 422 `jobs.rating_not_decidable`.
- **CANCELLED jobs are not rateable** — same 422 code.

## 10. Audit log

| Action             | Target           | Meta keys                     | Actor |
| ------------------ | ---------------- | ----------------------------- | ----- |
| `job.rating.write` | `JobRating:<id>` | `jobId`, `direction`, `score` | rater |

`comment` is intentionally not in the audit meta — we don't want the
audit log to mirror potentially-PII text. The full row is in
`JobRating` for ops investigations.

## 11. Edge cases

- **Job not COMPLETED** → 422 `jobs.rating_not_decidable`. Includes
  `CANCELLED` and all earlier states.
- **Already rated this direction** → 409 `jobs.rating_already_given`
  (P2002 caught in the service).
- **Cross-party rate** (an owner POSTing the partner endpoint, or
  vice-versa) — routed to a different controller, so they hit a
  `@Roles` mismatch (403) before reaching the service.
- **Job's partner profile is soft-deleted at rating time** — rating
  still allowed; the directory hides the partner anyway, so the
  rating is a record-keeping artefact.
- **Score 0 or > 5** rejected by Zod with `VALIDATION_FAILED`.

## 12. Out of scope

- **Auto-transition COMPLETED → RATED** — left for a polish slice.
- **Reply / dispute on a rating** — Phase 5+ moderation.
- **Per-service rating breakdowns** — top-level user average only.
- **Verified-job badges** — could derive from `JobRating` count later.
- **Tenant ratings of partners** — only owners book partners in v1.
- **Admin moderation of ratings** — later.

## 13. Acceptance criteria

- [x] Owner POST `/v1/me/service-jobs/:id/rating` on a `COMPLETED`
      job → creates an `OWNER_TO_PARTNER` rating; double-submit → 409.
- [x] Partner POST `/v1/me/jobs/:id/rating` on a `COMPLETED` job →
      creates a `PARTNER_TO_OWNER` rating; double-submit → 409.
- [x] Rating before `COMPLETED` → 422.
- [x] GET ratings endpoint returns both directions (each may be null).
- [x] `partnerSummarySchema` reads on `/v1/partners*` include
      `ratingAverage` + `ratingCount`.
- [x] Partners list default order is by `ratingAverage DESC NULLS LAST`.
- [x] Each rating write emits one `job.rating.write` audit row.
- [x] Migration applies cleanly on a fresh DB.

## 14. Manual test plan

1. Complete a job (owner → partner job hits `COMPLETED` from 5.2).
2. As owner, rate 5 stars + "great work" on the job detail page →
   see the confirmation, see the form replaced by "you rated 5★".
3. As that partner, rate 4 stars on the job → same confirmation.
4. Both sides see both ratings on the job detail page.
5. As a different owner, browse `/partners` → see the rated partner
   with one 5★ and average ★5.0; partners with no ratings appear
   after.

## 15. Rollout

- Migration is additive (empty table).
- No flag.
- Comms: dev changelog note ("partner ratings live — Phase 5 closes").
