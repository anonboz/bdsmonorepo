# Handoff — 2026-08-29 — announcements-and-meter-readings

> Session on `feat/landlord-properties` (4 commits: `2875440`, `d231e40`,
> `39431dc`, `0ac9b54`), continuing past the last-applied handoff
> (`2026-07-20-tenant-i18n-and-utility-billing`, applied on a sibling branch
> this one doesn't yet contain — see §4). Written for a fresh session to
> review with clean eyes.

---

## 1. What we built

Three features plus a cross-app fix. **(a) Announcements** (`2875440`) — a
two-tier announcement system: platform-wide "system" announcements
(`organizationId = null`, admin-authored) and per-org "landlord" announcements
(`organizationId` set, landlord-authored), both shown together on the tenant
home page. New: `Announcement` model + migration
(`20260722120000_add_announcements`), `admin/services/announcement.service.ts`
+ `/announcements` admin UI, `landlord/services/announcement.service.ts` +
`/announcements` landlord UI, `tenant/services/announcement.service.ts`
(`listMyAnnouncements`) + tenant home-page display, i18n strings (en/vi/zh).
**(b) Meter-reading tracking** (`d231e40`) — landlord-recorded cumulative
meter readings as the preferred consumption source for invoice generation,
replacing manual-only entry. New: `MeterReading` model + 2 migrations
(`20260828120000_add_meter_readings`, `20260828130000_add_meter_reading_is_reset`),
`landlord/services/meter-reading.service.ts` (record/list/update/delete,
non-decreasing-value validation, overdue nudges), `landlord/lib/storage.ts`
(Supabase Storage client, new `@supabase/supabase-js` dep,
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` env vars), `/meter-readings`
landlord UI, `invoice.service.ts` rewritten to optionally derive consumption
from a picked reading and stamp it "billed" transactionally, tenant bill
detail now shows the reading range + photo per metered line. **(c) Login fix**
(`39431dc`) — the submit button no longer flashes re-enabled between a
successful `signIn()` and `router.push()` landing, across all 5 apps.
**(d) Housekeeping** (`0ac9b54`) — regenerated `next-env.d.ts` for Next's new
`.next/dev/routes.d.ts` location, quote-style normalization, per-app
`.gitignore` for `.vercel/`. No packages removed.

---

## 2. New invariants discovered

1. **A `MeterReading` can back at most one invoice line item; once
   `lineItemId` is set it becomes immutable (no update/delete/re-bill).**
   - Enforced in `landlord/services/meter-reading.service.ts`
     (`updateMeterReading`/`deleteMeterReading` throw `ConflictError` if
     `lineItemId` is set) and `invoice.service.ts`
     (`resolveConsumption` throws `ConflictError` if `reading.lineItemId` is
     already set), with the actual stamping done inside the same
     `db.$transaction` that creates the invoice + line items.
   - Matters: without the transactional stamp, a race (or a retried request)
     could link the same reading to two invoices, double-billing the tenant
     for one delta of consumption.
   - Proposed home: `claude-context/domain/rent-billing.md` (extends the
     existing "invoice.amount must equal the sum of its line items" rule from
     the prior handoff).

2. **Consumption for a metered line = `reading.value − (immediately prior
   reading for the same unitId+kind by readingDate).value`; a reading with no
   prior, or itself flagged `isReset`, cannot be billed.**
   - Enforced in `invoice.service.ts` (`resolveConsumption`): throws
     `ConflictError` for `isReset` readings and for a missing prior reading.
   - Matters: billing a reset reading directly would charge the tenant for
     the *absolute* new meter value (e.g. a replaced meter starting at 0),
     not real consumption — a large, wrong bill.
   - Proposed home: `claude-context/domain/rent-billing.md`.

3. **Meter values must be non-decreasing within a (unitId, kind) reading
   history, unless the new reading is flagged `isReset`.**
   - Enforced in `meter-reading.service.ts` (`recordMeterReading` checks
     against the prior reading by date; `updateMeterReading` checks against
     *both* the prior and the next reading by date, since an edit can move a
     row's date).
   - Matters: without this check, a fat-fingered value produces a negative or
     wildly wrong consumption number silently (no crash — `resolveConsumption`
     just subtracts).
   - Proposed home: `claude-context/domain/rent-billing.md`.

4. **`Announcement.organizationId = null` means platform-wide (admin-owned,
   global exception); non-null means one landlord org's announcement
   (org-scoped).** Same shape as `UtilityRateBound`/`OrgUtilityRate` from the
   prior session.
   - Enforced by: `admin/services/announcement.service.ts` filters
     `organizationId: null` + `assertAdmin`; `landlord/services/announcement.service.ts`
     filters `organizationId: session.organizationId`; `tenant/services/announcement.service.ts`
     queries `organizationId: null OR organizationId IN (tenant's org ids via
     lease tenancies)`.
   - Matters: adding `where: { organizationId }` to the admin query (habit
     from the multi-tenant rule) would return nothing; omitting the tenant's
     org-id derivation would either leak other orgs' announcements or show
     none at all.
   - Proposed home: root `CLAUDE.md` — add `Announcement` to the global-
     exceptions list alongside `User`, `Vendor`, `Listing`, `UtilityRateBound`.

5. **A tenant's org membership for read-scoped-but-not-owned data (like
   announcements) is derived from `Tenancy → Lease.organizationId`, not
   stored on the session** — the tenant session has no `organizationId`.
   - Enforced in `tenant/services/announcement.service.ts`
     (`listMyAnnouncements` first queries the tenant's leases to collect
     distinct `organizationId`s, then filters announcements by that set).
   - Matters: this is the reusable pattern for any future tenant-facing,
     org-scoped read (e.g. tenant viewing landlord-specific policies) — the
     tenant app doesn't have a single `organizationId` to filter by; a tenant
     with leases across two orgs must see both.
   - Proposed home: `claude-context/auth-rules.md` or `claude-context/domain/leasing.md`.

6. **`router.push()` after `signIn()` does not block until the destination
   route has rendered — a submit-disabled flag must NOT be cleared on the
   success path, only on the error path.**
   - Enforced identically in all 5 apps' `app/login/page.tsx`.
   - Matters: clearing `pending` before `router.push()` resolves re-enables
     the submit button for one paint, visible as a flash; the fix relies on
     the form unmounting on navigation to avoid ever resetting `pending` on
     success.
   - Proposed home: `claude-context/ui-rules.md` (a general "async navigation
     doesn't block a pending-state reset" rule, reusable beyond login forms).

---

## 3. Gotchas hit during the build

None logged as newly surprising this session — the commits read as a clean
continuation of the previous session's patterns (transactional stamping
mirrors the itemized-invoice work; org-scoping mirrors `OrgUtilityRate`). No
`(!)`/WIP markers or revert commits in this range.

---

## 4. Contradictions with existing docs

**This branch (`feat/landlord-properties`) does not contain `claude-context/`
at all.** It branched off `108cdf8`, before `claude-context/` was created on
`docs/apply-handoff-tenant-i18n-and-utility-billing` (commit `82d93ca`, still
unmerged into this branch). Every "proposed home" above therefore names a
file that doesn't exist yet *on this branch* — they're proposals for whichever
session next merges/applies docs, not edits to make now. Root `CLAUDE.md`
*does* exist on this branch and its `@claude-context/...` references
currently point nowhere until that merge happens. Not a contradiction in the
rules themselves, just a branch-topology note worth surfacing before docs are
next applied.

---

## 5. Schema changes

Three migrations ran this session, all already applied to the shared dev DB:

- `20260722120000_add_announcements`
  - Added model `Announcement` (`organizationId String?` — null = system-wide;
    `title`, `body`, `publishedAt DateTime?` null = draft, `expiresAt DateTime?`
    null = never expires). Added `Organization.announcements` back-relation
    (implied by the FK).
- `20260828120000_add_meter_readings`
  - Added model `MeterReading` (`organizationId`, `unitId`, `kind
    InvoiceLineKind` — reuses the existing enum, water/electricity only by
    convention (Zod-enforced, not DB-enforced), `value Float`, `readingDate`,
    `note?`, `photoUrl?`, `lineItemId String? @unique` FK → `InvoiceLineItem`
    `onDelete: SetNull`). `@@unique([unitId, kind, readingDate])`.
- `20260828130000_add_meter_reading_is_reset`
  - Added `MeterReading.isReset Boolean @default(false)`.
- **`schema:map` / `pnpm schema:map`: still not applicable** — confirmed no
  such script exists anywhere in the repo (root or `packages/db`
  `package.json`). Unchanged from the prior handoff's note.
- **No new enum values** — `MeterReading.kind` reuses `InvoiceLineKind`
  (already has `rent`/`water`/`electricity`/`other`); only `water`/
  `electricity` are meaningful for a reading, enforced by the Zod schema's
  `METERED = ["water", "electricity"]`, not a DB constraint. Anyone adding a
  new `InvoiceLineKind` value should check whether it's meterable and, if so,
  whether `meter-reading.service.ts`'s `METERED` list needs it too.

---

## 6. What should NOT be in the docs

- The Supabase Storage bucket name (`meter-readings`), 8 MB size cap, and the
  allowed MIME-type list — implementation-specific constants, not invariants
  (though "photos go through server-only `lib/storage.ts` with the service-
  role key, never exposed to the client" is doc-worthy if a second upload
  feature shows up and someone reaches for a client-side Supabase client
  instead).
- The specific i18n strings added for announcements.
- Table/form markup and layout choices in `announcements-manager.tsx` /
  `meter-readings-manager.tsx`.
- The exact wording of the meter-value validation error messages.
- The `next-env.d.ts` / `.gitignore` / quote-style housekeeping commit
  (`0ac9b54`) — routine tooling churn, not a project pattern.
- The Session — Login-flash fix touches UI polish, not a security or data
  invariant beyond §2.6.

---

## 7. Open questions

1. **`MeterReading.kind` reuses `InvoiceLineKind` but only 2 of its 4 values
   are valid for a reading.** Split into a dedicated `MeterKind` enum
   (water/electricity only), or keep sharing the enum and rely on the Zod
   `METERED` allowlist? The current split (DB allows all 4, app layer
   restricts to 2) is a latent trap for any code that writes a `MeterReading`
   outside this service.
2. **Should the non-decreasing-value check be enforced at the DB level** (a
   trigger/constraint) rather than only in the service, given `@repo/db` is
   the only sanctioned write path today but isn't the *only possible* one?
3. **`claude-context/` branch topology (§4)** — should this branch merge/
   rebase onto `docs/apply-handoff-tenant-i18n-and-utility-billing` before
   more feature work lands, so context docs and code stop diverging? Left
   for a human to sequence.
4. **Announcement `expiresAt` with no `publishedAt`** — a draft
   (`publishedAt: null`) can still have an `expiresAt` set. Is that a valid
   state (an announcement that expires before it's ever published) worth a
   validation guard, or harmless because the tenant query already excludes
   unpublished rows regardless?
5. **Overdue-reading nudge is purely informational** (no enforced monthly
   cadence). Is a stricter cadence (e.g. blocking invoice generation without
   a current-month reading) wanted later, or is free-form recording the
   permanent design?
