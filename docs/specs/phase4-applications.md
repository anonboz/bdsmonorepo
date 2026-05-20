# Spec: Applications — apply, accept, draft lease (phase 4.4)

> Status: **implemented (sans Playwright e2e)**
> Phase: 4
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

The Phase 4 acceptance criterion in `BUILD_PLAN.md` is:

> Full flow: owner posts → admin approves → prospect applies → owner
> accepts → draft lease appears in owner app.

We've shipped owner-side (4.1), admin moderation (4.2), and the public
feed (4.3). This slice closes the loop: a signed-in tenant can apply
to a `LIVE` campaign; the owner can accept (which mints a `DRAFT` Lease
on the unit, closes the campaign, and auto-rejects siblings) or reject
with a reason.

## 2. User stories

- As a **signed-in prospect**, I want to apply to a campaign with an
  optional note so I can stake my claim.
- As a **prospect**, I want to see my application history and withdraw
  one I changed my mind about.
- As an **owner**, I want to see who has applied to my campaign, with
  the message they wrote.
- As an **owner**, I want one click to accept an application; the
  system should create the lease draft and close the listing so I
  can finalize terms.
- As an **owner**, I want to reject with a reason so the applicant
  knows why and other applicants on the same campaign can move on.

## 3. Screens / surfaces

| Surface               | App    | Route                                                                  | Notes                                         |
| --------------------- | ------ | ---------------------------------------------------------------------- | --------------------------------------------- |
| Apply form            | tenant | `/browse/[id]` (replaces the 4.3 placeholder CTA)                      | Renders only when signed in                   |
| My applications list  | tenant | `/me/applications`                                                     |                                               |
| My application detail | tenant | `/me/applications/[id]`                                                | Withdraw button while SUBMITTED               |
| Applications panel    | owner  | Campaign detail — `/houses/[id]/units/[unitId]/campaigns/[campaignId]` | New card listing applications + accept/reject |

## 4. API shape

```ts
// @repo/shared/schemas/applications.ts
export const applicationSchema = z.object({
  id: idSchema,
  campaignId: idSchema,
  ownerId: idSchema,
  applicantId: idSchema,
  applicantName: z.string(),
  status: applicationStatusSchema,
  message: z.string().max(2000).nullable(),
  rejectionReason: z.string().max(500).nullable(),
  decidedAt: isoDateTimeSchema.nullable(),
  decidedBy: idSchema.nullable(),
  /** Owner draft lease minted on accept. */
  createdLeaseId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const createApplicationSchema = z.object({
  campaignId: idSchema,
  message: z.string().trim().min(1).max(2000).optional(),
});

export const rejectApplicationSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  status: applicationStatusSchema.optional(),
});
```

### Endpoints

**Tenant** (`@Roles('TENANT')`):

| Method | Path                               | Description                            |
| ------ | ---------------------------------- | -------------------------------------- |
| POST   | `/v1/me/applications`              | `{ campaignId, message? }` → SUBMITTED |
| GET    | `/v1/me/applications`              | Paginated, status filter               |
| GET    | `/v1/me/applications/:id`          | One                                    |
| POST   | `/v1/me/applications/:id/withdraw` | SUBMITTED / REVIEWING → WITHDRAWN      |

**Owner** (`@Roles('OWNER')`), nested under the campaign:

| Method | Path                                                                 | Description                           |
| ------ | -------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/v1/houses/:hid/units/:uid/campaigns/:cid/applications`             | Paginated, status filter              |
| GET    | `/v1/houses/:hid/units/:uid/campaigns/:cid/applications/:aid`        | One                                   |
| POST   | `/v1/houses/:hid/units/:uid/campaigns/:cid/applications/:aid/accept` | `{}` → ACCEPTED + draft Lease + close |
| POST   | `/v1/houses/:hid/units/:uid/campaigns/:cid/applications/:aid/reject` | `{ reason }` → REJECTED               |

## 5. Data model changes

```prisma
model Application {
  // existing fields ...

  /// Denormalized from campaign.unit.house.ownerId. Indexed for the
  /// owner's "applications across all my campaigns" filter.
  ownerId String

  /// Set when status moves out of SUBMITTED/REVIEWING.
  decidedBy       String?
  rejectionReason String?  @db.VarChar(500)

  /// Filled on accept. One application → at most one lease.
  createdLeaseId String? @unique
  createdLease   Lease?  @relation("ApplicationLease", fields: [createdLeaseId], references: [id], onDelete: SetNull)

  @@index([ownerId, status])
}

model Lease {
  // existing fields ...

  /// Back-reference for application→lease provenance.
  application Application? @relation("ApplicationLease")
}
```

Migration: `application_owner_decision`. Table is empty in dev + prod
so `ownerId` lands NOT NULL straight away.

## 6. Workers / jobs

None. Rate limiting is a synchronous DB count in the service (see §9).

## 7. State machine

```
SUBMITTED ── owner accept ──► ACCEPTED
SUBMITTED ── owner reject ──► REJECTED
SUBMITTED ── tenant withdraw ──► WITHDRAWN

REVIEWING ── owner accept ──► ACCEPTED      (REVIEWING is a UX hint;
REVIEWING ── owner reject ──► REJECTED       the controller doesn't
REVIEWING ── tenant withdraw ──► WITHDRAWN   transition into it in v1)

(ACCEPTED / REJECTED / WITHDRAWN are terminal.)
```

`REVIEWING` exists in the enum from earlier work but no endpoint
transitions into it in this slice — keeping the surface minimal.
Owners eyeball SUBMITTED applications directly.

## 8. Accept side-effects (atomic)

`accept(applicationId, ctx)` opens one `$transaction` and does:

1. Reload the application + campaign + unit. Reject if:
   - Application is not `SUBMITTED` / `REVIEWING` → 422.
   - Campaign is not `LIVE` → 422 (someone else may have closed it).
   - Unit is not `VACANT` → 409 (race against a lease activation).
2. Create the new `Lease` with:
   - `unitId = campaign.unit.id`
   - `ownerId = campaign.ownerId`
   - `tenantId = application.applicantId`
   - `status = DRAFT`
   - `rentCycle = MONTHLY` (campaigns price by month)
   - `rentAmount = campaign.price`
   - `depositAmount = campaign.price` (one-month default; owner edits)
   - `currency = campaign.currency`
   - `startDate = today (UTC)`
   - `endDate = null`
3. Update the application: `status=ACCEPTED, decidedBy=actor,
decidedAt=now, createdLeaseId=<new lease id>`.
4. Update the campaign: `status=CLOSED` (an accepted listing is filled).
5. Auto-reject every other open application on the same campaign
   (`SUBMITTED` or `REVIEWING`): set
   `status=REJECTED, decidedBy=actor, decidedAt=now,
rejectionReason='Listing was filled.'`.
6. Write audit rows: `application.accept` for the accepted one,
   `lease.create_from_application` for the new lease, and one
   `application.auto_reject` per sibling.

All commit together. If any step throws, nothing changes.

## 9. Anti-spam

A signed-in tenant can submit at most **5 applications per 24h**. Check
on POST `/v1/me/applications`:

```ts
const recent = await prisma.application.count({
  where: { applicantId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
});
if (recent >= 5) throw rateLimited();
```

Returns `429 applications.rate_limited` with a `retryAfter` hint.
This is intentionally a simple count — not a token bucket — so the
implementation stays one query. A more sophisticated limiter lands when
Redis-backed rate limiting comes online platform-wide.

## 10. Permissions

- **TENANT** named on the application: read own, withdraw own.
- **OWNER** of the parent house: list / read / accept / reject every
  application on their campaigns. Cross-owner access → 404
  (existence-hiding, same pattern as leases).
- **ADMIN**: not in this slice. Admin moderation of applications is a
  later concern.
- **Tenant who is also the owner of the campaign** → 422
  `applications.self`. You can't apply to your own listing.

## 11. Audit log

| Action                          | Target             | Meta keys                                                   | Actor     |
| ------------------------------- | ------------------ | ----------------------------------------------------------- | --------- |
| `application.submit`            | `Application:<id>` | `campaignId`, `unitId`, `houseId`                           | applicant |
| `application.withdraw`          | `Application:<id>` | `previousStatus`, `campaignId`                              | applicant |
| `application.accept`            | `Application:<id>` | `campaignId`, `unitId`, `houseId`, `leaseId`                | owner     |
| `application.reject`            | `Application:<id>` | `previousStatus`, `reason`, `campaignId`                    | owner     |
| `application.auto_reject`       | `Application:<id>` | `previousStatus`, `campaignId`, `cause: 'sibling_accepted'` | owner     |
| `lease.create_from_application` | `Lease:<id>`       | `applicationId`, `campaignId`, `unitId`, `houseId`          | owner     |

Each row commits inside the same transaction as the change it audits,
extending the contract introduced in 3.5.

## 12. Edge cases

- **Duplicate apply** — `@@unique([campaignId, applicantId])` already
  prevents two open applications. Service catches P2002 → 409
  `applications.duplicate`. A tenant who withdrew an earlier application
  can re-apply (we don't try to "reopen" the WITHDRAWN row — Prisma's
  unique constraint blocks it; spec note: deferred to later when
  Application gets a soft-delete column).
- **Campaign not LIVE** → 422 `applications.campaign_not_live`.
- **Self-apply** → 422 `applications.self`.
- **Apply while suspended** — handled at AuthGuard; the request never
  reaches the service.
- **Owner accept after race** (campaign closed, unit occupied) → 409.
- **Reject without reason** — Zod rejects with `VALIDATION_FAILED`.
- **Withdraw a terminal application** → 422 `applications.not_decidable`.
- **Soft-deleted owner** — Application keeps the `ownerId` regardless
  (`onDelete: Restrict` on User would block a hard delete; we don't
  soft-delete users in current schema). Audit log records the action
  even if the actor is later deactivated.

## 13. Out of scope

- **Soft-delete of applications** — keep the row even after the user
  changes their mind, mostly for moderation evidence.
- **Application messaging thread** — tenant ↔ owner chat per application.
  4.5 / Phase 5 polish.
- **ID upload / KYC link** — applicants might want to attach an ID;
  we'll re-use the user-level KYC artefact (Phase 3.4a) instead.
- **Admin moderation of applications** — admins can already audit-log
  any decision; an explicit "reverse a reject" path is later.
- **Notifications / email on accept** — Phase 5+ (Resend wiring).
- **Bulk reject** — single-row UI for v1.
- **More sophisticated rate limiter** — Redis-backed token bucket later.

## 14. Acceptance criteria

- [x] Signed-in tenant POSTs `/v1/me/applications` for a LIVE campaign;
      gets an `Application` with status `SUBMITTED`.
- [x] Duplicate apply (same campaignId+applicantId) → 409.
- [x] Apply to a non-LIVE campaign → 422.
- [x] Apply to a campaign you own → 422.
- [x] Tenant withdraws own SUBMITTED application → status `WITHDRAWN`,
      audit row written.
- [x] Owner accepts → application `ACCEPTED`, campaign `CLOSED`, new
      DRAFT lease exists with rent/currency from the campaign, every
      sibling application becomes `REJECTED` with the canned reason.
- [x] Owner reject with reason → status `REJECTED`, reason stored.
- [x] Cross-owner access (other owner / other tenant) → 404.
- [x] Rate limiter caps a tenant at 5 applications per 24h → 6th
      returns 429 with a retry hint.
- [x] All migrations apply on a fresh DB.

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with the rest of Phase 4). Coverage held by the 14
cases in `applications.service.spec.ts`.

## 15. Manual test plan

1. As owner1, push a campaign through LIVE.
2. As tenant1 on the tenant app, sign in, hit `/browse/<id>` → submit
   the apply form → see the new application in `/me/applications`.
3. As owner1, open the campaign detail → see the application → click
   Accept → land on the new DRAFT lease editor.
4. Confirm `/v1/me/applications/:id` for tenant1 returns `ACCEPTED`
   with a non-null `createdLeaseId`.
5. As tenant2, try to apply to the now-CLOSED campaign → 422
   `applications.campaign_not_live`.
6. As tenant1, submit 5 more applications in a row → 6th returns 429.

## 16. Rollout

- No flag. Migration is additive (table empty).
- Backfill: none.
- Comms: dev changelog note ("apply flow live; phase 4 complete").
