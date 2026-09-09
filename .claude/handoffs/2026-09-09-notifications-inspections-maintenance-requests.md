# Handoff — 2026-09-09 — notifications, lease condition records, maintenance requests

Branch: `feat/landlord-properties` (merged to `main` at the end of this session).
Commits from this session, oldest first:

- `2b552c7` fix(ui): pass rendered icons to MobileNav across the RSC boundary
- `69a48fd` feat(tenant): in-app notification inbox with landlord producers
- `4bbd13c` feat(tenant): compact the home announcement card
- `2e666c8` feat(leases): lease detail pages with move-in/move-out condition records
- `1cd1310` feat(maintenance): tenants raise requests; landlord inbox + maintenance list
- `65e8420` feat(landlord): property, unit and listing CRUD pages (earlier-session work, committed as-is)

## 1. What we built

Three connected slices, no schema migration. **(a) In-app notifications**: the
`Notification` table finally has readers and writers. Tenant app: `/notifications`
inbox, bell with unread badge in both shells, `GET /api/notifications`,
`GET /api/notifications/unread-count`, `PATCH /api/notifications/:id`,
`POST /api/notifications/read-all`. Landlord app: the same four routes, page and
bell. Producers: landlord `generateInvoice` / `createLease` / announcement
publish (draft→published only) notify the lease's or org's tenants; tenant
`createMyTicket` notifies the org's owner/landlord/agent members. Types live in
`packages/shared/src/notifications.ts`. **(b) Lease detail + condition records**:
`/leases/:id` (landlord) and `/my-leases/:id` (tenant). Landlords record
move-in/move-out inspections with notes and photos (`Inspection` row on the
unit + `Document` rows of type `inspection_photo`, entityType `"Inspection"`);
tenants see them read-only. New Supabase bucket `inspection-photos`. Routes:
`GET/POST /api/leases/:id/inspections`, `PATCH/DELETE /api/inspections/:id`,
`POST /api/inspections/:id/photos`, `DELETE /api/inspections/:id/photos/:photoId`.
`leaseInspectionWindow` in `packages/shared/src/inspections.ts` derives a
lease's inspections. **(c) Maintenance requests**: tenants submit from
`/my-tickets` (`POST /api/my-tickets`); landlord gets a read-only `/maintenance`
list (the nav link existed but 404'd). Also: `MobileNav` icons are now rendered
nodes (RSC fix) and it gained an `actions` slot; tenant home announcement card
capped at 3 with clamped bodies; seed adds `tenant@test.com` as co-tenant on the
Apt 1A lease, a move-in inspection, and sample notifications.

## 2. New invariants discovered

**Notifications are per-user and global — add `Notification` to the root
"global exceptions" list.**
- Rule: notification reads/writes scope by `session.userId` only, never by
  `organizationId`; assert `row.userId === session.userId` after every
  `findUnique`.
- Enforced: `apps/tenant/services/notification.service.ts`,
  `apps/landlord/services/notification.service.ts` (read side).
- Why: a tenant has no org in session and can rent from several orgs; an org
  filter is either impossible or wrong. Missing the ownership assert lets any
  user mark anyone's rows read (and read titles containing property names).
- Home: root `CLAUDE.md` foot-guns (global exceptions: `User`, `Vendor`,
  `Listing`, **`Notification`**).

**A producer derives recipients from rows it has already ownership-checked,
never from request input.**
- Rule: `notifyLeaseTenants` / `notifyOrgTenants` / `notifyUsers` take a
  lease/org id the caller has asserted belongs to `session.organizationId`
  (landlord) or a lease the caller has asserted the tenant is on (tenant).
  Never pass a `userIds` array or lease id straight from the body.
- Enforced: comments + call sites in `invoice.service.ts`, `lease.service.ts`,
  `announcement.service.ts`, `ticket.service.ts`.
- Why: otherwise a caller can fan notifications (with another org's property
  names in the body) to arbitrary users.
- Home: `claude-context/auth-rules.md` (or a new `domain/notifications.md`).

**Notifications are written in the same transaction as the event they announce.**
- Rule: pass the `tx` client into the notify helper; never notify after the
  transaction commits or before the row exists.
- Enforced: `generateInvoice`, `createLease`, `createMyTicket` all use
  `db.$transaction` and pass `tx`. (Announcement publish is a single update
  followed by a notify — acceptable because the update is one statement, but
  it is the one exception.)
- Why: phantom notifications about invoices that failed to save, or invoices
  with no notification, are both user-visible bugs.
- Home: `domain/notifications.md` (new) or `prisma-patterns.md`.

**`deepLink` is a route in the *recipient's* app.**
- Rule: rows for tenants carry tenant-app paths (`/my-bills/:id`,
  `/my-leases`, `/`); rows for staff carry landlord-app paths (`/maintenance`).
  The inbox renders `deepLink` as an app-relative `<Link>`.
- Enforced: by convention in producers only; the column is a plain string.
- Why: a landlord path in a tenant row is a dead link (typedRoutes can't check
  a DB string).
- Home: `domain/notifications.md`.

**A lease's inspections are derived by creation window, so inspections are
created only from a lease's page.**
- Rule: an inspection belongs to the lease on its unit whose `createdAt` ≤
  `inspection.createdAt` < next lease's `createdAt` on that unit. Never create
  an `Inspection` from a unit-level screen.
- Enforced: `leaseInspectionWindow` in `@repo/shared`, used by
  `apps/landlord/services/inspection.service.ts` and
  `apps/tenant/services/lease.service.ts`. Creation is only via
  `POST /api/leases/:id/inspections`.
- Why: `Inspection` has no `leaseId`. Break the window and move-in photos
  attach to the wrong tenancy — exactly the deposit-dispute case they exist for.
- Home: `domain/leasing.md` (and cross-ref from `domain/deposits.md`). See
  open question 2 about adding a real `leaseId`.

**Inspection photo `Document` rows are org-scoped and typed; removal asserts
both.**
- Rule: create with `organizationId` from session, `type: "inspection_photo"`,
  `entityType: "Inspection"`; `removeInspectionPhoto` asserts
  `doc.organizationId === session.organizationId && doc.type === "inspection_photo"`.
- Enforced: `inspection.service.ts`.
- Why: `Document` is a generic table; without the type check a photo route
  could delete a lease agreement row by id.
- Home: `domain/documents.md`.

**Tenant-created maintenance requests take `organizationId` and `unitId` from
the tenant's own lease.**
- Rule: `createMyTicket` loads the lease, asserts a `Tenancy` for
  `session.userId`, refuses non-current leases, and copies org/unit from it.
  The body carries only `leaseId`, title, description, priority.
- Enforced: `apps/tenant/services/ticket.service.ts`.
- Why: the tenant session has no org; accepting `unitId`/`organizationId`
  from the body lets a tenant file into any org.
- Home: `domain/maintenance.md` + `auth-rules.md` (tenant scoping section).

**Props from a Server Component into a `@repo/ui` client component must be
serializable — pass rendered elements, not component references.**
- Rule: `MobileNavItem.icon` is `React.ReactNode`; layouts render
  `<Icon className=… />` before handing items over.
- Enforced: the type in `packages/ui/src/components/mobile-nav.tsx`.
- Why: lucide icons are `forwardRef` objects; passing them threw "Only plain
  objects can be passed to Client Components" in every app layout.
- Home: `ui-rules.md` (and `gotchas.md`).

## 3. Gotchas hit during the build

**RSC serialization error from `MobileNav`.**
- Symptom: `Only plain objects can be passed to Client Components …
  {href, icon: {$$typeof, render}, label}` at `AppLayout`.
- Root cause: component references crossing the server→client boundary.
- Fix: `icon: React.ReactNode`; all five layouts map NAV to rendered icons.
- Add to gotchas: **yes** (any new shared client component will hit it).

**`typedRoutes` makes `tsc` fail on a brand-new route until types regenerate.**
- Symptom: `Type '"/notifications"' is not assignable to type 'UrlObject |
  RouteImpl<"/notifications">'` right after adding the page.
- Root cause: `.next/types/routes.d.ts` is generated by the dev server or
  `next typegen`; a fresh route dir isn't in it yet.
- Fix: run `npx next typegen` in the app before `tsc --noEmit`.
- Add to gotchas: **yes** (tenant and landlord both have `typedRoutes: true`;
  CI should run typegen before typecheck).

**Pre-commit hook checks Prettier across the whole tree, not just staged files.**
- Symptom: a commit of formatted files failed because unrelated, unstaged WIP
  files were unformatted.
- Root cause: `.husky/pre-commit` runs `prettier --check "**/*"`.
- Fix: formatted the WIP files (whitespace only). Consider `lint-staged`.
- Add to gotchas: **yes**.

**Supabase public URLs still return 200 after the object is deleted.**
- Symptom: `DELETE …/photos/:id` succeeded, the public URL still served the
  image.
- Root cause: CDN edge cache on public buckets; the object *was* gone
  (verified by listing the bucket with the service-role client).
- Fix: none needed; verify deletes via `storage.from(bucket).list()`, not by
  fetching the URL. Applies to listing and meter-reading photos too.
- Add to gotchas: **yes**.

**Git Bash `curl` mangles leading-slash strings and can't reach Supabase.**
- Symptom: `-w "/leases/… %{http_code}"` printed `C:/Program Files/Git/leases/…`;
  `curl https://<project>.supabase.co/…` returned `000`.
- Root cause: MSYS path conversion of arguments starting with `/`; TLS/proxy
  quirk of the bundled curl. Node `fetch` works fine.
- Fix: use Node for external checks; avoid leading `/` in curl `-w` strings.
- Add to gotchas: **maybe** — one line under "local dev on Windows".

**`scripts/check-user.mjs` is broken.**
- Symptom: `ERR_MODULE_NOT_FOUND … packages/db/dist/client.js`.
- Root cause: imports a build output path that no longer exists; the other
  `scripts/*.mjs` also target a stale `:4001` API. Not committed (untracked).
- Fix: not fixed this session; use the app's credentials callback instead.
- Add to gotchas: no — fix or delete the scripts (open question 8).

## 4. Contradictions with existing docs

1. **Root `CLAUDE.md` references files that do not exist.** It `@`-loads
   `claude-context/auth-rules.md`, `api-patterns.md`, `prisma-patterns.md`,
   `ui-rules.md`, `architecture.md`, `package-architecture.md`, `pwa.md`,
   `realtime.md`, `gotchas.md`, `domain/INDEX.md` and "each app has
   `apps/<app>/CLAUDE.md`". None of these paths exist in the repo (there is
   no `claude-context/` directory and no per-app `CLAUDE.md`). Either the
   directory was never committed or it lives elsewhere. Proposed: restore or
   create them; until then the root file should not claim they exist.
2. **`@repo/domain` does not exist.** CLAUDE.md says "Never import
   `@repo/domain` inside `@repo/db` (direction is `domain → db`)". The
   packages are `db`, `shared`, `ui`. Framework-agnostic logic actually lives
   in `@repo/shared` (errors, money, and now notifications + inspections).
   Proposed rule: "`@repo/shared` has no React/Next/Prisma runtime imports;
   `@repo/db` never imports `@repo/shared` or `@repo/ui`."
3. **Global exceptions list is incomplete.** "Global exceptions: `User`, the
   `Vendor` marketplace, and the `Listing` search index." `Notification` is
   also global (per-user). Add it.
4. **`end-of-build-handoff.md` mentions `pnpm schema:map`.** The repo is npm
   workspaces (`packageManager: npm@10.8.3`) and has no `schema:map` script.
   Same for `_start-server.bat`, which still uses `pnpm --filter` and ports
   4000–4030 (apps run on 6100–6105 via npm).
5. **"Route → service → Prisma. No business logic in components."** Holds,
   but note the photo routes legitimately call `lib/storage.ts` *between*
   session and service (upload first, then persist the URL). Worth stating
   as the sanctioned exception so nobody "fixes" it.

## 5. Schema changes

None. No migration ran; `schema.prisma` untouched. Notes for whoever updates
docs:

- `Notification.type` is a plain `String`; the allowed values are the
  code-level `NOTIFICATION_TYPES` in `@repo/shared`
  (`invoice_created`, `lease_created`, `announcement_published`,
  `maintenance_request_created`). Adding one means updating the tenant
  `notifications.types` i18n map and the landlord `TYPE_LABELS`.
- `Document.entityType` now has a live value: `"Inspection"`.
- **Infra, not schema:** a public Supabase Storage bucket `inspection-photos`
  was created with the service-role key (same shape as `meter-readings` and
  `listing-photos`). Bucket provisioning is manual and undocumented — see
  open question 6.

## 6. What should NOT be in the docs

- The exact i18n strings, and the Vietnamese choice of "Thông báo" for
  notifications vs "Thông báo chung" for the announcement type.
- Bell polling cadence (60 s, `staleTime` 30 s), inbox cap (100 rows),
  badge "99+" — tuning, not rules.
- The `MobileNav` `actions` slot and where the bell sits in each shell.
- Announcement card limit of 3 and two-line clamp.
- The near-duplicate `NotificationBell` / `NotificationList` in tenant and
  landlord — a refactor candidate (open question 1), not a doc rule.
- Seed contents (`tenant@test.com`, sample notifications, the move-in
  inspection) and the fact that a September 2026 test invoice exists on the
  dev DB from a producer test.
- One-off `*.tmp.ts` / `*.tmp.mjs` scripts run from inside `packages/db` or
  `apps/landlord` to reach workspace modules — a session technique.
- Untracked scratch left in the tree: `scripts/*.mjs`, `_claude.bat`,
  `_start-server.bat`, `works.txt`, `.claude/projects/`.

## 7. Open questions

1. Share one `NotificationBell` + `NotificationList` from `@repo/ui`
   (needs `@tanstack/react-query` as a `@repo/ui` dependency and label props
   for i18n), or keep per-app copies until admin/agent/vendor need inboxes?
2. Add `Inspection.leaseId` (a real migration) and drop the creation-window
   rule? The window works because inspections are only created from a lease
   page; a `leaseId` would make that structural.
3. Should tenants upload their own move-in photos (co-signed condition
   record), or stay read-only? Built read-only.
4. Notification audiences: should landlords also get `invoice_created` /
   `lease_created` echoes? Should vendors get `maintenance_request_created`
   once work orders are assigned? Should platform admins get anything?
5. Maintenance triage is the obvious next slice (status changes, work-order
   creation, vendor assignment) and would add the first tenant-facing
   `maintenance_status_changed` producer.
6. Where should Supabase bucket provisioning live — a checked-in script, a
   README section, or SQL against `storage.buckets` in a migration?
7. Push (Serwist is already in tenant/vendor) and email delivery: same
   `Notification` rows, new transports. Decide before the type list grows.
8. `scripts/*.mjs`, `_start-server.bat`, `_claude.bat`, `works.txt` — commit
   (after fixing), `.gitignore`, or delete?
9. `packages/ui` has no `tsconfig.json`; running `tsc` there picks up a
   sibling repo (`../../house-renting-starter`). Add a tsconfig or exclude.
10. `docs/apply-handoff-*` branches suggest the docs pipeline expects
    `claude-context/` to exist — confirm whether it was lost in the
    "rewrite/house-renting-arch" history before re-creating it.
