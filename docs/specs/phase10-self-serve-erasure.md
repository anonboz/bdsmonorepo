# Spec: Self-serve account deletion (phase 10.6)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 9.3 shipped admin-driven GDPR erasure: support clicks
"erase" and the user's PII is anonymized, S3 assets purged,
PostHog person deleted. The user has no path of their own — they
have to email support and wait. That's both bad UX (a user
deciding to leave shouldn't need a human gate) and a compliance
gap (right-to-be-forgotten implies user-initiated).

Phase 10.6 closes the 9.3 follow-up: users can schedule their own
erasure from the app. The request lands a confirmation email
with an undo link, parks the row for 7 days (configurable via
PlatformConfig), then a daily sweeper runs the existing 9.3
flow unattended. The user gets a final "your account has been
erased" email; nothing they can recover at that point.

The sweeper reuses the 9.3 erasure body exactly — same row
anonymization, same S3 purge, same PostHog delete, same audit
trail. Only the entry point + the wait window are new.

## 2. User stories

- As a **tenant**, I can click "Delete my account" in settings,
  confirm in a modal, and receive an email with an undo link
  immediately. The app shows "scheduled for deletion on
  <date>" so I know it's queued.
- As a **user who changed my mind**, I can click the undo link
  in the email (or hit cancel in the app) within the grace
  window and continue using my account. I get a confirmation
  email that the request was cancelled.
- As **support**, when a user reaches out asking "did I really
  schedule this?" I can pull `/v1/admin/users/:id` and see the
  pending request (deferred — admin read of erasure-request
  state lands here in 10.6b polish). For v1 the user's own
  GET endpoint is the source of truth.
- As **ops**, the daily sweep reports `{ executed, skipped }`
  counts; an audit row lands per execution so the per-user
  timeline is preserved.

## 3. Surfaces

| Surface         | App / file                                                                                                                      | Notes                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Schema          | `packages/db/prisma/schema.prisma`                                                                                              | New `AccountErasureRequest` model; `PlatformConfig.accountErasureGraceDays` column (default 7).               |
| Shared types    | `packages/shared/src/schemas/account-erasure.ts` (new)                                                                          | Request shape, response shape, undo-token shape.                                                              |
| Self-serve API  | `apps/api/src/account/account-erasure.controller.ts` (new)                                                                      | `GET / POST / DELETE /v1/me/erase-request`; public `POST /v1/account/erase-cancel?token=`.                    |
| Service         | `apps/api/src/account/account-erasure.service.ts` (new)                                                                         | request / cancel / executeIfDue. Calls into a shared `performErasure` extracted from 9.3's AdminUsersService. |
| Admin reuse     | `apps/api/src/admin/admin-users.service.ts`                                                                                     | `erase` becomes a thin wrapper that delegates to `accountErasureService.execute` with the admin actor.        |
| Sweeper         | `apps/api/src/account/account-erasure.sweeper.ts` (new)                                                                         | Daily BullMQ scheduler, mirrors the 9.x sweeper pattern.                                                      |
| Emails          | `apps/api/src/common/mailer/mailer.service.ts`                                                                                  | Three new direct sends (request confirmation, cancellation, completion) — bypasses notification preferences.  |
| Queue           | `apps/api/src/queues/queue-names.ts`                                                                                            | `QUEUE_ACCOUNT_ERASURE_SWEEP`, `JOB_ACCOUNT_ERASURE_SWEEP`, repeat-id constant.                               |
| Metrics         | `apps/api/src/admin/admin-metrics.service.ts`                                                                                   | New queue surfaces in `/v1/admin/metrics`.                                                                    |
| Tenant PWA      | `apps/tenant/app/(authed)/settings/_components/delete-account.tsx` (new); `apps/tenant/app/account/erase-cancel/page.tsx` (new) | "Delete my account" button + pending banner; public undo route hits the API + redirects to a success page.    |
| Tenant settings | `apps/tenant/app/(authed)/settings/page.tsx` (new or existing)                                                                  | Hosts the new delete component.                                                                               |

Other PWAs (owner / partner / admin) get the same self-serve
button in 10.6b. The backend supports all roles today.

## 4. API shape

```ts
// packages/shared/src/schemas/account-erasure.ts

export const accountErasureRequestSchema = z.object({
  /** Set by the server; the user can't choose. */
  executeAfter: isoDateTimeSchema,
  requestedAt: isoDateTimeSchema,
  cancelledAt: isoDateTimeSchema.nullable(),
});
export type AccountErasureRequestResponse = z.infer<typeof accountErasureRequestSchema>;

export const eraseCancelInputSchema = z.object({
  /** 64-char hex emitted in the confirmation email. */
  token: z.string().min(32).max(128),
});
export type EraseCancelInput = z.infer<typeof eraseCancelInputSchema>;
```

Endpoints:

| Method | Path                                         | Role(s)                    | Description                                                                                        |
| ------ | -------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/v1/me/erase-request`                       | TENANT/OWNER/PARTNER/ADMIN | `200 { executeAfter, requestedAt, cancelledAt: null \| ISO } \| 404` if no row.                    |
| POST   | `/v1/me/erase-request`                       | TENANT/OWNER/PARTNER/ADMIN | Schedule erasure. Idempotent — re-posting returns the existing pending row. 422 if already erased. |
| DELETE | `/v1/me/erase-request`                       | TENANT/OWNER/PARTNER/ADMIN | Cancel (authed). Idempotent — returns 204 even if nothing was scheduled.                           |
| POST   | `/v1/account/erase-cancel` (public, no auth) | (none)                     | Body: `{ token }`. Cancels via the email-link token. 422 on bad token.                             |

The public cancel endpoint is unauthenticated by design: the user
who got the email is the same person who scheduled the erasure
(or has access to their inbox); requiring a fresh login to undo
defeats the "click and forget" UX. The token is single-use and
scoped to the request id.

## 5. Data model changes

```prisma
model AccountErasureRequest {
  /// 1:1 with User — only one pending request at a time.
  userId  String @id
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  requestedAt  DateTime @default(now())
  /// Sweeper picks up rows where `executeAfter <= now AND cancelledAt
  /// IS NULL AND completedAt IS NULL`.
  executeAfter DateTime

  /// 64-char hex used by the public cancel endpoint. Regenerated
  /// every time `request` is invoked (e.g. re-request after cancel).
  undoToken    String   @db.VarChar(128)

  /// Set when the user cancels (authed or via undo link). The row
  /// stays for audit; the sweeper filters on this column.
  cancelledAt  DateTime?

  /// Set when the sweeper executes. Once set the row is terminal —
  /// re-requesting would race the already-anonymized User row.
  completedAt  DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([executeAfter, cancelledAt, completedAt])
}

model PlatformConfig {
  // ...existing fields unchanged...
  /// Phase 10.6 — days between a user requesting erasure and the
  /// sweeper executing. Default 7; admin can raise to give users
  /// more buffer if support load is high.
  accountErasureGraceDays Int @default(7)
}
```

Migration name: `account_erasure_request`.

## 6. Workers / jobs

New queue `account.erasure-sweep` registered alongside the
others. Cron pattern `15 4 * * *` — 04:15 UTC daily, 15 minutes
after the bills sweep (03:00) and 2 hours after the payouts
sweep (02:00). Keeps DB pressure spread.

Per sweep:

1. `findMany` rows where `executeAfter <= now AND cancelledAt IS NULL AND completedAt IS NULL`.
2. For each row:
   - Call `AccountErasureService.execute(userId, { actorId: userId, ip: null, userAgent: null })`. Same anonymization + S3 + PostHog flow as 9.3.
   - Mark `completedAt = now()`.
   - Send the "your account has been erased" email (last touch from us).
   - Audit `user.erase.completed` (the 9.3 audit row already covers this when called from the service — re-using one path means one source of truth).
3. Return `{ executed, skipped }` for the BullMQ result.

The `actorId = userId` choice keeps the audit timeline coherent:
the user took the action (it just happened on a delay), so the
actor is them, not `null` (system). Compare with the admin path
where the actor is the admin's id.

API_DISABLE_QUEUES guard: same pattern — sweeper class isn't
registered when the env flag is set.

## 7. Emails

Sent direct via `MailerService.send()`, bypassing the
notification system. These are transactional security emails
the user cannot mute.

| Event             | Template (inline in service)                                                                                         | Trigger                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Request confirmed | "Your account is scheduled for deletion on <date>. Didn't mean to do this? <undo link>." Plain HTML + text fallback. | `POST /v1/me/erase-request` succeeds.         |
| Cancelled         | "Your account deletion was cancelled. No further action needed."                                                     | `DELETE /v1/me/erase-request` or public undo. |
| Completed         | "Your account has been deleted. Thanks for using BDS." Final goodbye.                                                | Sweeper executes the row.                     |

Email rendering is minimal — these aren't marketing emails, they
need to be obvious + short. The undo link points at the tenant
PWA's public `/account/erase-cancel?token=…` route which proxies
to the API.

## 8. Permissions

Self-serve routes scoped to the authenticated user. The public
cancel endpoint authenticates via the undo token (HMAC-strength
random; 64-char hex = 256 bits of entropy from CSPRNG). No admin
write surface in this slice — admin can already erase directly
via 9.3.

## 9. Edge cases

- **User re-requests after a previous cancel**: a new row replaces
  the old one (or we update in place — see "race with sweeper"
  below). The undo token rotates.
- **Race with the sweeper**: re-requesting an already-completed
  row would race the anonymized User row. The service checks
  `completedAt IS NULL` + the User's `deletedAt IS NULL` before
  upserting; 422 if already erased (mirrors the admin endpoint).
- **Cancel after the sweeper started**: the sweeper sets
  `completedAt` inside the same tx that anonymizes. Once the tx
  commits there's no row to cancel — the cancel endpoint returns
  204 (idempotent) but the user is already deleted. Window for
  this race is the duration of the tx, ~milliseconds.
- **Token reuse**: the undo endpoint deletes / clears the token
  after a successful cancel. A second cancel attempt with the
  same token gets a 404.
- **User in middle of OTP-sign-in flow**: the auth flow runs as
  normal; the User row is fully present until the sweeper fires.
  Sessions are torn down by the existing Cascade on User.
- **Re-erasure**: the existing 9.3 logic 422s on an already-
  erased target. The sweeper checks `completedAt` first to
  short-circuit instead of letting the inner call throw — that
  way a botched migration that left rows in inconsistent state
  doesn't 422-spam ops.
- **PlatformConfig grace days set to 0**: the request is still
  scheduled, but `executeAfter = now()` — the next sweep tick
  picks it up. Documented + supported (useful for tests).

## 10. Out of scope

- **Other PWAs**: owner / partner / admin get the same button in
  10.6b. The backend supports them today.
- **Admin read of pending erasure requests**: support can guide
  users to cancel via the email link. An admin list view lands
  in 10.6b.
- **Reactivation after sweep**: out of GDPR scope — once the
  sweeper runs, the data is gone (anonymized + S3 purged). A
  user signing up again gets a fresh User row.
- **Configurable per-role grace windows**: one platform-wide
  number for v1.
- **Email re-send on schedule** ("3 days left to undo"): nice-
  to-have, deferred. The user has the original confirmation
  email.

## 11. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] Migration adds `AccountErasureRequest` + the new
      `PlatformConfig.accountErasureGraceDays` column on a fresh DB.
- [ ] `AccountErasureService.request` unit-tested for: schedules with
      executeAfter = now + grace, generates a token, sends the
      confirmation email, is idempotent (re-request on a pending
      row returns the same row), 422 on an already-erased user.
- [ ] `AccountErasureService.cancel` unit-tested for: clears the
      pending row, sends the cancelled email, idempotent on
      already-cancelled / no-row.
- [ ] `AccountErasureSweeper.process` unit-tested for: runs
      `execute` on due rows, marks `completedAt`, sends the
      goodbye email, skips already-cancelled / completed rows.
- [ ] Public cancel endpoint unit-tested for: valid token cancels,
      bad token 422s, used token cannot cancel a second time.
- [ ] `AdminUsersService.erase` continues to work via the shared
      `execute` path; existing admin-users.service spec still passes.

## 12. Manual test plan

1. Start API + Redis + a real mailer (MailHog).
2. Sign in as a tenant.
3. Navigate to settings, click "Delete my account", confirm.
4. Inbox shows the request-confirmed email with an undo link.
5. `GET /v1/me/erase-request` returns the scheduled row.
6. Click the undo link → tenant PWA's `/account/erase-cancel`
   route hits the public API, cancellation lands.
7. Inbox shows the cancellation email.
8. Re-request, then wait for the sweeper window (or manually
   set `executeAfter = now()` in the DB).
9. Run `pnpm exec tsx scripts/fire-account-erasure.ts` (one-off
   helper, not committed) or trigger the sweep via BullMQ admin.
10. User row is anonymized, S3 assets purged, PostHog deleted,
    completion email lands.

## 13. Rollout

- Forward-only Prisma migration; additive only.
- `PlatformConfig.accountErasureGraceDays` defaults to 7; admins
  can adjust via 9.6's existing config-update endpoint (which
  will need a small Zod schema extension — included in this
  slice's shared types).
- No new env vars; existing mailer + `API_DISABLE_QUEUES` carry over.
- No feature flag; the endpoints are visible from the first
  deploy. Users who don't use them see no behavior change.
