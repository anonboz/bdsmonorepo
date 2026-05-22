# Spec: GDPR user erasure (phase 9.3)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Every prior slice from 8.x onwards has called out "GDPR-erasure flow
will purge this" as a planned-but-deferred follow-up. Real users with
real requests will land soon; we need a single admin-only entrypoint
that:

- Anonymises PII in the User row (email, phone, displayName).
- Soft-deletes the User row via the existing `deletedAt` column.
- Purges every owned `MediaAsset` from S3 + flips the rows to
  `DELETED` (column reserved in 8.4 for exactly this).
- Best-effort deletes the person from PostHog so analytics history
  no longer ties events to a deleted natural person.
- Writes a final `user.erase` audit row capturing the chain of side
  effects.

Legal-retention rows (Bill, Payment, AuditLog) **stay** — financial
records have statutory retention; the audit log preserves
accountability for past mod actions. The User FK on those rows has
`onDelete: SetNull` since Phase 1, so the actor on legacy audit rows
becomes `null` without rewriting history.

## 2. User stories

- As **legal**, when a user files a deletion request I send the
  admin their user id; the admin clicks "Erase user (GDPR)" and the
  flow completes idempotently within seconds.
- As **the user being deleted**, my profile no longer surfaces in
  any directory (deleted partner profile, no listings, ratings show
  as "Deleted user"); my owned photos return 404 from S3; PostHog
  shows me as deleted.
- As an **auditor**, the audit log has a `user.erase` row with the
  list of side effects (counts of MediaAssets purged, PostHog status,
  anonymized fields) so a compliance review can trace what we did.
- As a **developer**, the flow is one HTTP call from one role
  (ADMIN); idempotent — a second click after success returns 409
  `admin.user_already_in_state` instead of double-running side
  effects.

## 3. Surfaces

| Surface      | App / file                                           | Notes                                                                                                                      |
| ------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| API endpoint | `apps/api/src/admin/admin-users.controller.ts`       | `POST /v1/admin/users/:id/erase` (ADMIN-only)                                                                              |
| Service      | `apps/api/src/admin/admin-users.service.ts`          | `erase(id, ctx)` orchestrator; reuses `loadOrFail`, `assertNotSelf`, audit logger.                                         |
| Storage      | `apps/api/src/common/storage/storage.service.ts`     | New `deleteObject({ bucket, key })` — `DeleteObjectCommand` wrapper, idempotent.                                           |
| Analytics    | `apps/api/src/common/analytics/analytics.service.ts` | New `deletePerson({ distinctId })` — DELETE against PostHog's GDPR endpoint. No-op if `POSTHOG_PERSONAL_API_KEY` is unset. |
| Env          | `apps/api/src/env.ts`                                | New `POSTHOG_PERSONAL_API_KEY?` (only required for PostHog deletion; the analytics surface keeps working without it).      |
| Admin UI     | `apps/admin/app/(authed)/users/[id]/page.tsx`        | "Erase user (GDPR)" button + confirm dialog; disabled if already erased.                                                   |
| Error codes  | `packages/shared/src/errors/codes.ts`                | `ADMIN_USER_ALREADY_ERASED` (new — distinct from the generic `ADMIN_USER_ALREADY_IN_STATE` so the UI can branch on it).    |

## 4. Data model

No new tables or columns. The erasure flow uses the columns 8.x
already left empty for it:

- `User.deletedAt` — set to `now()` on erasure.
- `User.email/phone/displayName` — overwritten with deterministic
  `deleted-<id>` placeholders.
- `MediaAsset.status` — flipped from `UPLOADED` to `DELETED` after
  the S3 object is purged.
- `MediaAsset.deletedAt` — set to `now()` for parity.

## 5. Erasure flow

```
1. ADMIN clicks "Erase user (GDPR)" → POST /v1/admin/users/:id/erase.
2. AdminUsersService.erase:
   a. assertNotSelf (admin can't erase themselves).
   b. loadOrFail(id); 422 if already erased (`deletedAt` set).
   c. Collect a list of UPLOADED MediaAssets owned by the user.
   d. In a single Prisma $transaction:
        - UPDATE User SET email=null, phone=null, displayName='deleted-<id>',
          deletedAt=now() WHERE id=<id>
        - UPDATE MediaAsset SET status='DELETED', deletedAt=now()
          WHERE ownerUserId=<id> AND status != 'DELETED'
        - INSERT AuditLog action='user.erase' with the side-effect
          counts in `meta`.
   e. **Outside the tx**, side-effects (best-effort, errors logged
      but don't roll back the anonymization):
        - For each collected MediaAsset, `storage.deleteObject(...)`.
        - `analytics.deletePerson({ distinctId: id })`.
3. 200 returns the anonymized User row.
```

Why the side effects run **after** the tx commits: S3 + PostHog
calls can't be rolled back. We persist the canonical state change
(the DB row anonymization) first, then fire-and-forget the external
purges. A failed S3 delete leaves the object in storage with no
local row pointing at it — operator can purge manually via the
audit-row's MediaAsset id list.

## 6. Anonymisation rules

```ts
{
  email: null,
  phone: null,
  displayName: `deleted-${user.id.slice(0, 8)}`,
  // KYC + role state preserved so historical audit rows still
  // resolve roles correctly via the still-present (but anonymized)
  // User row.
}
```

`User.id` itself is **not** anonymized — too many FKs point at it
(bills, payments, audit rows, leases). `SetNull` on actor refs
already handles "actor was deleted, show as anonymous" downstream.

Email is set to `null` (not a deterministic string) so the unique
index keeps working when the same email gets re-used later by a
genuinely new signup.

## 7. PostHog deletion

PostHog's GDPR delete API is:

```
DELETE ${POSTHOG_HOST}/api/projects/@current/persons/?distinct_id=<id>
Authorization: Bearer ${POSTHOG_PERSONAL_API_KEY}
```

We wire this as a fire-and-forget call inside
`AnalyticsService.deletePerson`. When `POSTHOG_PERSONAL_API_KEY` is
unset (local dev, CI), the call is skipped + a warning logs — the
audit row records `posthog_deleted: false` so ops can spot un-purged
PostHog state.

The `POSTHOG_KEY` env var (used for capture) is a project-scoped
ingest key with no delete permission. The Personal API key is a
separate, admin-scoped credential — keeping them split limits
blast radius if either leaks.

## 8. Permissions

- `@Roles('ADMIN')` on the endpoint.
- `assertNotSelf` — admins can't erase their own account; that
  needs a second admin.
- No additional gate beyond the existing `RolesGuard`.

## 9. Edge cases

- **User has no MediaAssets**: tx runs the User update + audit row;
  S3 step is a no-op (no objects to delete).
- **S3 object already missing**: `deleteObject` is idempotent in
  the S3 API — a 404 is success. We catch + log other errors but
  don't fail the request.
- **PostHog API key missing**: skipped; audit records the gap.
- **Re-running erasure on an already-erased user**: 422
  `admin.user_already_erased`. No-op, no audit row, no side
  effects.
- **User is the platform admin running the request**: 422
  `admin.cannot_act_on_self`.
- **A new MediaAsset is uploaded between the SELECT and the UPDATE**:
  the `WHERE status != 'DELETED'` clause catches it, but the S3
  delete loop runs on the snapshot we read pre-update. That row's
  S3 object stays — operator cleans up manually.

## 10. Audit

```
action: 'user.erase'
target: User:<id>
actorId: <admin-id>
meta: {
  mediaAssetsPurged: <count>,
  mediaAssetsS3Failures: <count>,
  posthogDeleted: <boolean>,
  posthogStatus: <number | null>,   // HTTP status when called; null if skipped
  anonymizedFields: ['email', 'phone', 'displayName'],
}
```

## 11. Out of scope

- **Hard-delete of legal-retention rows** (Bill, Payment, AuditLog).
  These have statutory retention; anonymizing the actor via the
  existing `SetNull` cascade is the right shape.
- **Receipts already mailed to the user**: stay in Resend / Mailhog
  history. PDF receipts in S3 (none yet — Phase 8 receipts are
  inline emails) would be in scope when we ship them.
- **User-initiated erasure**: v1 is admin-driven only. A self-serve
  "delete my account" flow is a follow-up.
- **Cascade hard-delete of associated rows** (PartnerProfile,
  Service, Lease, Ticket, etc.): all already on `onDelete: Cascade`
  in the Prisma schema, but we **don't** trigger that here — we soft-
  delete the User so the cascades don't fire. The
  `deletedAt`-aware reads everywhere else (bills service, tickets,
  etc.) filter the deleted user's rows out of public listings
  without needing to nuke them from the DB.
- **Notification of erasure to the deleted user**: out of scope —
  they requested deletion; sending one more email would be
  perverse.

## 12. Acceptance criteria

- [ ] `POST /v1/admin/users/:id/erase` returns 200 with the
      anonymized User row.
- [ ] Calling it on the admin's own id → 422
      `admin.cannot_act_on_self`.
- [ ] Calling it on an already-erased user → 422
      `admin.user_already_erased`.
- [ ] User's email, phone, displayName are replaced; deletedAt is
      set; KYC + roles preserved.
- [ ] Every UPLOADED MediaAsset owned by the user is flipped to
      DELETED + has `deletedAt` set; the S3 object is deleted.
- [ ] An audit row `user.erase` exists with the side-effect counts
      in meta.
- [ ] When `POSTHOG_PERSONAL_API_KEY` is unset, the request
      succeeds + the audit row records `posthogDeleted: false`.
- [ ] When `POSTHOG_PERSONAL_API_KEY` is set, the request fires a
      DELETE against the PostHog persons endpoint with the user's id
      as `distinct_id` (verified via the mock in the unit spec).
- [ ] `pnpm turbo typecheck`/`lint`/`test` all clean.

## 13. Manual test plan

1. Seed a tenant with one bill + one MediaAsset (campaign photo).
2. From `/admin/users/<id>`, click "Erase user (GDPR)" + confirm.
3. Verify:
   - `/admin/users/<id>` shows displayName `deleted-xxxx` and
     `deletedAt: ...`.
   - MinIO console: the photo object is gone.
   - Audit log shows the `user.erase` row with `mediaAssetsPurged: 1`.
4. Click "Erase user (GDPR)" again — 422 with the
   already-erased code.

## 14. Rollout

- No DB migration.
- Vercel env: optional `POSTHOG_PERSONAL_API_KEY` — set on the API
  project's prod env when the Sentry-equivalent erasure tooling is
  needed.
- No backfill.
