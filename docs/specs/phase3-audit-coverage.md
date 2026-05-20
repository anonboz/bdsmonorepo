# Spec: Audit log coverage (phase 3.5)

> Status: **implemented (sans Playwright e2e)**
> Phase: 3
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Phase 3.4a shipped `AuditLogger` and audit rows for user moderation + KYC.
Phase 3.4b extended it to house moderation. The other sensitive mutations
in the system still write nothing:

- Owners can flip a lease ACTIVE/ENDED/TERMINATED with no audit trail.
- Bills materialize from a BullMQ worker or "generate now" click and we
  have no record of who or what created them.
- Sessions appear and disappear with no log entry — "who actually signed
  in?" answers come from session-table forensics, not the audit log.

This slice closes those gaps using the same `AuditLogger` service. After
3.5 every state change you might be asked to recover should be in
`AuditLog`. Phase 5 will extend the same machinery to payment provider
webhooks once Stripe/VNPay are wired.

## 2. User stories

- As an **admin**, I want every lease transition recorded so I can
  answer "who terminated lease X and when?" without a SQL session.
- As an **admin**, I want every bill creation recorded so I can tell
  whether a bill came from the daily sweep or from a manual click.
- As an **admin**, I want to see when a user signed in or out so I can
  investigate "this user was active at 03:00 — was that them?"

## 3. Screens / surfaces

No new UI. Existing `/audit-log` viewer in the admin app already
renders every new action because it has no per-action filter list. The
admin user-detail "Audit history" link continues to work.

The only API change is: the existing `transition` / `generate-now` / auth
endpoints write new audit rows; nothing about request/response shapes
changes.

## 4. Action catalog

| Action            | Target          | Meta keys                                                           | Actor                       |
| ----------------- | --------------- | ------------------------------------------------------------------- | --------------------------- |
| `lease.activate`  | `Lease:<id>`    | `previousStatus` (LeaseStatus), `unitId`, `houseId`                 | owner of the parent house   |
| `lease.end`       | `Lease:<id>`    | `previousStatus`, `unitId`, `houseId`                               | owner                       |
| `lease.terminate` | `Lease:<id>`    | `previousStatus`, `terminationReason` (string), `unitId`, `houseId` | owner                       |
| `bill.generate`   | `Bill:<id>`     | `leaseId`, `idempotencyKey`, `periodStart` (YYYY-MM-DD), `source`   | owner id or `null` (worker) |
| `auth.login`      | `User:<userId>` | `sessionId`, `ipAddress`, `userAgent`                               | the user themselves         |
| `auth.logout`     | `User:<userId>` | `sessionId`                                                         | the user themselves         |

`bill.generate.source` is `'owner'` for the "Generate now" button and
`'sweeper'` for the worker.

Each lease/bill mutation runs the change and the audit write inside the
same Prisma `$transaction` (same atomicity contract as
`AdminUsersService`). Auth events are written best-effort _after_ the
session row commits — better-auth manages the session transaction
itself, so we hook the `databaseHooks.session.create.after` /
`session.delete.after` events. A failed audit write does not undo the
login.

## 5. Data model changes

None. `AuditLog` already covers `actorId`, `action`, `target`, `meta`,
`ip`, `userAgent`.

## 6. Workers / jobs

The bills sweeper / generator already runs in BullMQ. We pass
`actor: null` and `source: 'sweeper'` for those calls so the audit row
is still recorded with attribution.

## 7. Permissions

No new endpoints, so no new role gates. Audit _reads_ still go through
the existing admin-only `/v1/admin/audit-log`.

## 8. Code layout changes

- Extract `AuditLogger` + the existing `RequestContext` type from
  `apps/api/src/admin/` into `apps/api/src/common/audit/`.
- Add `AuditModule` exporting `AuditLogger`. `AdminModule`, `LeasesModule`,
  and `BillsModule` import it; admin code keeps working unchanged
  through the same export.
- `RequestContext` becomes `apps/api/src/common/audit/request-context.ts`
  with a helper `requestContextFrom(user, req)` so every controller
  builds it the same way.

## 9. Edge cases

- **Transition fails the validation guard** (e.g. ACTIVE→ACTIVE) — the
  audit row is NOT written. We only audit successful state changes.
- **Bill generation hits the unique constraint** — the existing
  `'idempotent'` branch already returns the prior bill; we do NOT write
  a second audit row in that case. Source attribution should match what
  _would_ have happened if the row was new — but skipping the duplicate
  is correct: we don't want to log "owner generated bill" twice for the
  same period.
- **Auth login from a Better-Auth verification step** — the OTP /
  magic-link verify endpoint creates the session; that's where the hook
  fires. Email verification with no session create does not write a row.
- **Session lazy-expiry** — better-auth doesn't fire delete on
  natural-expiry reads. That's fine: we only audit explicit logouts +
  admin-initiated session revocation (which also goes through delete).
- **Audit writer fails for an auth event** — log + continue; we don't
  let an audit failure block a login. (Different from
  domain mutations, where the transaction rolls back.)

## 10. Out of scope

- **`auth.login_failed`** — better-auth doesn't surface a "verify failed"
  hook and parsing the controller's response shape is fragile. Adding it
  needs either an upstream hook PR or response-aware middleware; punt.
- **Payment webhook audit rows** — no payment provider is wired in
  Phase 3. Lands in Phase 5 alongside Stripe / VNPay.
- **Config changes** — there is no config domain yet.
- **`lease.create` / `lease.update` / `house.create` / etc.** — creates
  and DRAFT-edits aren't sensitive enough to warrant audit. State
  transitions are.
- **CSV export of the audit log** — same status as before (deferred).
- **Forwarding audit entries to an external SIEM** — later.

## 11. Acceptance criteria

- [x] Owner activates a lease → audit row `lease.activate` with
      `previousStatus: 'DRAFT'` in meta. Lease + audit row commit
      atomically.
- [x] Owner ends a lease → `lease.end` written; unit flips VACANT in
      the same transaction.
- [x] Owner terminates a lease with reason → `lease.terminate` includes
      the `terminationReason` in meta.
- [x] Owner clicks "Generate now" → `bill.generate` with
      `source: 'owner'`.
- [x] BullMQ sweeper generates a bill → `bill.generate` with
      `source: 'sweeper'` and `actorId: null` (default ctx).
- [x] Idempotent re-generation does NOT write a second audit row.
- [x] Successful sign-in → `auth.login` with the new session id in meta
      (wired via `databaseHooks.session.create.after`).
- [x] Sign-out → `auth.logout` with the session id
      (`databaseHooks.session.delete.after`).
- [x] Failed transition (validation rejection) → no audit row written.
- [x] All existing unit tests still pass; new tests cover the
      lease-transition + bill-generate audit writes (109 total / +6).

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(matches the rest of Phase 3). Auth-hook behavior is covered by the
manual test plan since it requires a real Better-Auth session round-trip.

## 12. Manual test plan

1. As admin, open `/audit-log` to see a baseline count.
2. As owner, activate a DRAFT lease → admin refreshes → one new
   `lease.activate` row newest first.
3. As owner, click "Generate now" → one `bill.generate` row.
4. Sign out, then sign back in → two new auth rows.
5. Try to activate an already-ACTIVE lease (force the 422) → the row
   count does NOT increment.

## 13. Rollout

- No flag, no migration. Pure additive surface in the API.
- Backfill: none. Historical state has no audit; we start logging
  forward from deploy.
- Comms: changelog note.
