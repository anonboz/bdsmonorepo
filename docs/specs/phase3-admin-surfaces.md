# Spec: admin surfaces v1 (Phase 3.4a)

> Status: **draft**
> Phase: 3
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

The admin app has been login + landing only since Phase 1. To close
Phase 3's "Admin can suspend a user; that user is blocked across all
apps on next request" acceptance criterion and to start operating the
platform, admin needs real surfaces.

This slice ships the **highest-leverage trio**: user list, suspend, KYC
review — plus the audit log infrastructure they all write to. The other
Phase 3.4 items (house moderation, fee config, platform dashboards) come
in follow-ups.

## 2. User stories

- As an **admin**, I want to see all users so I know who's on the
  platform.
- As an **admin**, I want to suspend a user (e.g., abuse, non-payment)
  so they can't act anywhere on the platform until I unsuspend.
- As an **admin**, I want to review users awaiting KYC and approve or
  reject (with a reason) so the platform can trust who they say they are.
- As an **admin**, I want every sensitive action to be auditable so
  there's a record of who did what when.
- As an **admin**, I want to browse the audit log to investigate
  questions after the fact.

## 3. Screens

| Surface     | App   | Route         | Notes                                  |
| ----------- | ----- | ------------- | -------------------------------------- |
| Users list  | admin | `/users`      | Filter by role / status / KYC          |
| User detail | admin | `/users/[id]` | Profile + Suspend + KYC actions        |
| Audit log   | admin | `/audit-log`  | Paged viewer, filter by actor / action |
| Landing     | admin | `/`           | Cards for users / audit log            |

## 4. API shape

```ts
// @repo/shared/schemas/admin.ts
export const adminUserSchema = z.object({
  id: idSchema,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  displayName: z.string(),
  roles: z.array(roleSchema),
  kycStatus: kycStatusSchema,
  isSuspended: z.boolean(),
  lastLoginAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const listAdminUsersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(), // email / displayName
  role: roleSchema.optional(),
  kycStatus: kycStatusSchema.optional(),
  isSuspended: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .optional(),
});

export const suspendUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const unsuspendUserSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const kycDecisionSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('APPROVED') }),
  z.object({ decision: z.literal('REJECTED'), reason: z.string().min(1).max(500) }),
  z.object({ decision: z.literal('PENDING') }), // admin can re-queue
  z.object({ decision: z.literal('NONE') }), // admin can reset
]);

export const auditLogEntrySchema = z.object({
  id: idSchema,
  actorId: idSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(), // e.g. "user.suspend"
  target: z.string().nullable(), // e.g. "User:abc"
  meta: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});

export const listAuditLogQuerySchema = paginationQuerySchema.extend({
  actorId: idSchema.optional(),
  action: z.string().max(100).optional(), // prefix-match e.g. "user.*"
  target: z.string().max(120).optional(),
});
```

### Endpoints

| Method | Path                               | Notes                                   |
| ------ | ---------------------------------- | --------------------------------------- |
| GET    | `/v1/admin/users`                  | Paginated, filterable                   |
| GET    | `/v1/admin/users/:id`              | Single user (incl. counts of relations) |
| POST   | `/v1/admin/users/:id/suspend`      | `{ reason }` → flips `isSuspended=true` |
| POST   | `/v1/admin/users/:id/unsuspend`    | `{ reason }` → `isSuspended=false`      |
| POST   | `/v1/admin/users/:id/kyc-decision` | Discriminated decision                  |
| GET    | `/v1/admin/audit-log`              | Paginated, filterable                   |

All ADMIN-only.

## 5. Authorization model

- `Roles('ADMIN')` decorator on every endpoint.
- Already-suspended ADMIN can't act — AuthGuard rejects on every request.
- An admin **cannot suspend themselves** (422 with a friendly message).

## 6. Data model changes

None. Existing tables:

- `User` has `isSuspended` (Boolean) + `kycStatus` (enum).
- `AuditLog` has `actorId`, `action`, `target`, `meta` (JSON), `ip`,
  `userAgent`, `createdAt`.

Optional polish (deferred): `User.suspendedAt`, `User.kycDecidedAt`,
`User.kycDecidedBy`. For now, the audit log entry is the durable record.

## 7. Audit log

Every sensitive action writes one row inside the same Prisma `$transaction`
as the change. The catalog:

| Action             | Target      | Meta keys                                             |
| ------------------ | ----------- | ----------------------------------------------------- |
| `user.suspend`     | `User:<id>` | `reason` (string), `previousState` ({suspended:bool}) |
| `user.unsuspend`   | `User:<id>` | `reason`, `previousState`                             |
| `user.kyc.approve` | `User:<id>` | `previousStatus` (KycStatus)                          |
| `user.kyc.reject`  | `User:<id>` | `reason` (string), `previousStatus`                   |
| `user.kyc.pending` | `User:<id>` | `previousStatus`                                      |
| `user.kyc.reset`   | `User:<id>` | `previousStatus`                                      |

IP and UA come from the request (Fastify headers). The actor is the
authenticated admin (`AuthenticatedUser.id`).

This catalog is the prefix list the audit log viewer's filter offers.

## 8. Edge cases

- **Suspending an already-suspended user** → 409 `admin.user_already_in_state`.
- **Unsuspending a user that isn't suspended** → same 409.
- **Admin suspends themselves** → 422 `admin.cannot_act_on_self`.
- **Setting KYC to its current state** → 409 `admin.user_already_in_state`.
- **REJECTED KYC without reason** → 422 from the discriminated union.
- **Audit log writer fails** → the whole transaction rolls back. We
  never apply a change without a paired audit entry.

## 9. Out of scope

- **House / listing moderation queue** — needs a `flagged` state on
  House first; deferred.
- **Fee / commission config** — separate domain; deferred (lands when
  partner payouts come up in Phase 5).
- **Platform-wide dashboards** (active users, GMV, ticket SLA) — needs
  aggregation queries similar to the owner dashboard but cross-tenant.
- **Bulk actions** — single-row UI for now.
- **CSV export of audit log** — later.
- **Searchable audit log full-text** — prefix match on `action` and
  exact match on `actorId` / `target` is enough for v1.

## 10. Acceptance criteria

- [ ] Admin GETs `/v1/admin/users` → paginated list of every user.
- [ ] Admin POSTs suspend → user's `isSuspended` flips → audit entry
      recorded → that user gets `403 auth.account_suspended` on their
      next request from any app.
- [ ] Admin POSTs unsuspend → flips back → audit entry → user can act
      again.
- [ ] Admin posts KYC decision (APPROVED / REJECTED+reason / PENDING /
      NONE) → user's `kycStatus` updates → audit entry.
- [ ] Admin POSTs an action that doesn't change anything (e.g. suspend
      an already-suspended user) → 409 `admin.user_already_in_state`.
- [ ] Admin tries to suspend themselves → 422 `admin.cannot_act_on_self`.
- [ ] Non-admin (owner / tenant / partner) on any of these → 403
      `auth.role_mismatch`.
- [ ] Admin GETs `/v1/admin/audit-log` → newest first, paginated.
- [ ] All 33 turbo tasks stay green; new specs cover action +
      audit-log write atomicity.

## 11. Manual test plan

1. `pnpm turbo dev --filter=@repo/api --filter=@repo/admin --filter=@repo/owner`.
2. Sign in as `admin@example.com` in the admin app, open `/users` →
   see 9 seeded users.
3. Open `owner1`'s detail → click "Suspend" → enter reason → confirm.
4. In another tab as `owner1@example.com`, hit `/houses` → 403 redirect
   on next request (the SSR `/v1/me` call returns 403).
5. As admin, click "Unsuspend" → owner1 can act again.
6. Click "Reject KYC" on `tenant1` with reason "ID photo unreadable" →
   user's KYC status flips to REJECTED in the list.
7. Open `/audit-log` → see all four entries (suspend, unsuspend, reject)
   newest first.

## 12. Rollout

- No migration. No env vars. No feature flag.
- Pure additive endpoints + new admin pages.
