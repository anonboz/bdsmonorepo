# Spec: Contract e-signature v1 (phase 12.3)

> Status: **drafting**
> Phase: 12
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Lease activation today flips `DRAFT → ACTIVE` on the owner's
unilateral action. No record of the tenant's acknowledgement, no
audit-quality trail, no signature block on receipts. Pre-launch we
want an in-platform contract acknowledgement loop: owner captures
their signature, tenant counter-signs, both signatures persist with
IP + UA + timestamp, the receipt PDF surfaces them.

V1 is **captured signatures + audit row + PDF block.** Not a
legally-binding e-signature under Vietnam's Electronic Transactions
Law 2005 — that requires integration with a registered certificate
authority (FPT.eContract / VNPT.eContract) and is deferred to Phase 13. V1 is sufficient for in-platform acknowledgement + dispute trail.

## 2. User stories

- As an **owner**, I want to finish a lease draft, click "Send for
  signatures", draw my signature on a canvas, and have the tenant
  see a "Sign your lease" prompt the next time they open the app.
- As a **tenant**, I want to see clearly when a lease needs my
  signature, draw it on a canvas, and have the lease flip to
  `ACTIVE` once both parties have signed.
- As an **operator** investigating a dispute, I want to see in
  `AuditLog`: who signed, when, from which IP / UA, and (via the
  receipt PDF) the captured signature image.
- As an **owner**, the receipt PDF I download for a paid bill shows
  both signature blocks beneath the totals, with dates.

## 3. Surfaces

| Surface           | App / file                                                                                          | Notes                                                                                                         |
| ----------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| DB model          | `packages/db/prisma/schema.prisma`                                                                  | New `Signature` table + `LeaseStatus.AWAITING_SIGNATURES`.                                                    |
| Shared schemas    | `packages/shared/src/schemas/signatures.ts` + `enums/misc.ts`                                       | `Signature`, `CreateSignatureInput`, `SignatureRole`; mirror new enum value.                                  |
| API module        | `apps/api/src/signatures/*`                                                                         | Tenant + owner POST endpoints; service auto-flips lease to `ACTIVE` when both rows land.                      |
| Lease transitions | `apps/api/src/leases/leases.service.ts`                                                             | `ALLOWED_TRANSITIONS` extends to `DRAFT → AWAITING_SIGNATURES` + `AWAITING_SIGNATURES → ACTIVE / TERMINATED`. |
| Receipt PDF       | `apps/api/src/bills/bills.receipt.service.ts`                                                       | Append signature block (owner + tenant images + dates) below the totals.                                      |
| Tenant UI         | `apps/tenant/app/(authed)/my-leases/[leaseId]/_components/signature-pad.tsx`                        | Canvas-based signature capture; "Sign your lease" CTA on lease detail.                                        |
| Owner UI          | `apps/owner/app/(authed)/houses/[id]/units/[unitId]/leases/[leaseId]/_components/signature-pad.tsx` | Same pad; owner signs after sending for signatures.                                                           |
| i18n              | `packages/i18n/src/messages/{en,vi}/{tenant,owner}.json`                                            | Status label, sign CTA, signature panel copy.                                                                 |
| Tests             | `apps/api/src/signatures/signatures.service.spec.ts`                                                | Per-role auth, status guards, auto-activate-on-both, idempotency, max-size.                                   |

## 4. Data model

### 4.1 New `Signature` table

```prisma
enum SignatureRole {
  OWNER
  TENANT
}

model Signature {
  id            String        @id @default(cuid())
  leaseId       String
  signerId      String
  role          SignatureRole
  /// Base64-encoded PNG data URI (`data:image/png;base64,...`). Stored
  /// inline because signatures are small (~10-30KB) and the
  /// access pattern is "join with lease, render in PDF" — no need
  /// for a separate S3 round-trip on every read.
  imageDataUri  String        @db.Text
  ip            String?
  userAgent     String?
  signedAt      DateTime      @default(now())

  lease   Lease @relation(fields: [leaseId], references: [id], onDelete: Cascade)
  signer  User  @relation(fields: [signerId], references: [id], onDelete: Restrict)

  // One signature per (lease, role) — re-signing replaces the
  // existing row via upsert in the service.
  @@unique([leaseId, role])
  @@index([signerId])
}
```

Server-side cap on `imageDataUri` length: **100 KB raw string**
(roughly 75 KB of PNG bytes after base64 decode). Anything bigger →
413 `signatures.too_large`.

### 4.2 LeaseStatus enum extension

```prisma
enum LeaseStatus {
  DRAFT
  AWAITING_SIGNATURES   // ← new
  ACTIVE
  ENDED
  TERMINATED
}
```

Migration is additive — existing `DRAFT` / `ACTIVE` / `ENDED` /
`TERMINATED` rows are untouched. New leases created via the owner
flow still default to `DRAFT`; existing `ACTIVE` leases never
re-enter the signing loop.

### 4.3 State machine extension

| From                | To                  | Trigger                                          |
| ------------------- | ------------------- | ------------------------------------------------ |
| DRAFT               | AWAITING_SIGNATURES | Owner clicks "Send for signatures" (transition). |
| DRAFT               | TERMINATED          | Owner cancels (unchanged from today).            |
| AWAITING_SIGNATURES | ACTIVE              | Auto when both signatures land (no manual step). |
| AWAITING_SIGNATURES | DRAFT               | Owner clicks "Back to draft" (re-edit).          |
| AWAITING_SIGNATURES | TERMINATED          | Either party cancels before both sign.           |
| ACTIVE              | ENDED, TERMINATED   | Unchanged.                                       |

Notes:

- `DRAFT → ACTIVE` is **removed**. Owners must go through
  `AWAITING_SIGNATURES`. This is a breaking change to the UI — the
  "Activate" button becomes "Send for signatures".
- Going back from `AWAITING_SIGNATURES → DRAFT` drops any captured
  signatures (cascade via `onDelete: Cascade` on the relation).
  Re-signing is required after editing.

## 5. API

### 5.1 Endpoints

```
POST   /v1/me/leases/:id/signatures
  → tenant signs their lease

POST   /v1/houses/:houseId/units/:unitId/leases/:id/signatures
  → owner signs the lease

GET    /v1/me/leases/:id   (extended)
  → response includes `signatures: Signature[]` so the UI can
    render "you've signed / waiting for owner" etc. without a
    second round-trip.
```

Request body for both POSTs:

```ts
{
  imageDataUri: string; // 'data:image/png;base64,...'
}
```

Response:

```ts
Signature; // the inserted row, normalised to ISO strings
```

### 5.2 Authorization

- Tenant endpoint: actor must be `Lease.tenantId`.
- Owner endpoint: actor must own the parent unit's house (existing
  `assertOwnerOfLease` helper).
- Lease must be in `AWAITING_SIGNATURES`. Any other status → 422
  `signatures.lease_not_awaiting`.

### 5.3 Auto-activate-on-both

Inside the same Prisma `$transaction` as the signature insert:

1. Upsert the `Signature` row by `(leaseId, role)`.
2. Count signatures for this lease.
3. If `count === 2` (owner + tenant present):
   - `Lease.status = 'ACTIVE'`.
   - `Unit.status = 'OCCUPIED'`.
   - Audit `lease.activate` with `meta.via = 'signatures'`.
   - Dispatch a notification to the owner (`BILL_PAID` is the
     wrong topic — we add `LEASE_ACTIVATED` if not present, else
     reuse audit-log + email separately. **Out of scope for v1**:
     a new notification topic; the existing audit row is enough.)

Per-signature audit row: `signature.captured` with
`meta.role`, `meta.leaseId`, `meta.byteSize`.

### 5.4 Idempotency / re-signing

Upsert by `(leaseId, role)`. Re-submitting overwrites the previous
image but does NOT delete the audit row from the first submission.
The new row carries a fresh `signedAt`. Auto-activate logic still
fires correctly on the second submission if the counter-signature
arrived between.

### 5.5 Size + format validation

- Reject if `imageDataUri` doesn't start with `data:image/png;base64,`.
- Reject if length > 100 KB (raw string). Renders as a clear
  `signatures.too_large` problem.
- No image decoding / dimension check — trust the client.

## 6. UI

### 6.1 Shared signature-pad component (per app)

Vanilla `<canvas>` (no new npm dep). Touch + mouse events; renders
a smoothed stroke via straight-line interpolation between consecutive
points (no Bezier — keep it small). API surface:

```tsx
<SignaturePad
  onChange={(dataUri: string | null) => void}
  onClear?={() => void}
  width={320}
  height={120}
/>
```

The pad is mounted per app (`apps/tenant/...` + `apps/owner/...`)
not in `@repo/ui` — keeps the dependency boundary clean and lets
each app skin the canvas independently. Shared lift to `@repo/ui`
is a follow-up if a third caller appears.

### 6.2 Tenant — `/my-leases/[leaseId]`

When `lease.status === 'AWAITING_SIGNATURES'`:

- Show a `Card` titled **"Sign your lease"**.
- If `signatures.find(s => s.role === 'TENANT')` exists → render
  "✓ You signed on {date}" + "waiting on owner" sub-text if
  owner hasn't signed.
- Else render the `SignaturePad` + "Submit signature" button. POST
  to `/v1/me/leases/:id/signatures` on submit. On success refresh
  the page.

### 6.3 Owner — lease detail

When `lease.status === 'DRAFT'`:

- "Send for signatures" button (replaces today's "Activate").
  Posts the existing transitions endpoint with
  `{ to: 'AWAITING_SIGNATURES' }`.

When `lease.status === 'AWAITING_SIGNATURES'`:

- Same signature panel as tenant, but for the owner role.
- "Back to draft" button (transitions to `DRAFT`, drops both
  signatures via cascade — surface this in a confirm dialog).

When `lease.status === 'ACTIVE'`:

- Read-only "Both parties signed" card with timestamps. The two
  captured images render as thumbnails for the audit / dispute path.

## 7. Receipt PDF

`apps/api/src/bills/bills.receipt.service.ts` extends to include the
two signature images beneath the totals when present:

```
─────────────────────────────────────
SIGNATURES

Owner: <image>          Tenant: <image>
Signed 2026-05-24       Signed 2026-05-24
```

Implementation: extend `RECEIPT_INCLUDE` with
`lease: { include: { signatures: true } }`. Inside `renderPdf`, after
the totals + `hr`, draw the signature block. `pdfkit` accepts a
`Buffer` for `doc.image()`; decode the data URI:

```ts
const pngBytes = Buffer.from(dataUri.replace(/^data:image\/png;base64,/, ''), 'base64');
doc.image(pngBytes, { fit: [180, 60] });
```

If a lease has only one signature (rare race: receipt downloaded
between the two sign events), show only that block.

## 8. Out of scope

- **Legal e-signature with a registered CA.** Phase 13 picks up
  FPT.eContract or VNPT.eContract for VN's Electronic Transactions
  Law 2005 compliance.
- **Multi-signer leases.** v1 hard-codes owner + tenant. A second
  tenant on a shared lease can't co-sign.
- **Witnessed signatures** (third-party witness role).
- **Drawing tool polish.** No undo, no variable line width, no
  vector export. Vanilla canvas only.
- **Signature image processing.** No EXIF strip, no thumbnail
  variant, no S3 upload — the data URI lives in the DB column.
  Phase 13 may move them to S3 if storage becomes a concern.
- **Email-based signing.** No magic-link "sign your lease" emails
  in v1. Tenant must log in to the PWA. A future slice can add an
  in-platform notification + email when a lease enters
  `AWAITING_SIGNATURES`.
- **Backfilling existing ACTIVE leases.** They stay ACTIVE without
  signatures; the receipt PDF shows the signature block only when
  the rows exist.

## 9. Edge cases

- **Tenant signs before owner.** No special behavior — the
  Signature row lands; lease stays in `AWAITING_SIGNATURES` until
  the owner row also lands.
- **Owner reverts to DRAFT after both signatures land.** Not
  possible — `AWAITING_SIGNATURES → DRAFT` is allowed only while
  the lease is still in `AWAITING_SIGNATURES`. Once it hits
  `ACTIVE`, the path back is `ENDED` or `TERMINATED`.
- **Lease is terminated mid-signing.** Cascade deletes any
  captured signatures — they aren't needed; the lease is gone.
- **Concurrent signing race** (both submit at the same time): both
  inserts land via upsert; the second transaction sees `count === 2`
  and triggers the auto-activate. Idempotent — the first never sees
  count 2 because its insert hasn't committed yet.
- **Receipt PDF downloaded after one signature but before both.**
  Renders the one block; the other is omitted. Comment in the PDF
  layer documents this.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean.
- [ ] Owner clicks "Send for signatures" on a DRAFT lease; status
      flips to `AWAITING_SIGNATURES`.
- [ ] Both parties can independently sign from their respective
      lease-detail screens; lease auto-flips to `ACTIVE` only when
      the second signature lands.
- [ ] `AuditLog` shows `signature.captured` per submission and
      `lease.activate` with `meta.via = 'signatures'` on the
      auto-flip.
- [ ] Receipt PDF for a bill on an ACTIVE lease shows both
      signature blocks beneath the totals.
- [ ] Re-submitting a signature overwrites the previous image
      (upsert), doesn't 4xx.
- [ ] `> 100 KB` payload → 413 `signatures.too_large`.
- [ ] Non-PNG / non-base64 payload → 422 `signatures.invalid_format`.

## 11. Rollout

- DB migration is additive (new table + new enum value); zero
  downtime.
- No env vars.
- No feature flag — owners see the new "Send for signatures" CTA on
  their next page load. Existing `ACTIVE` leases are unaffected.
- Tenants who land on `/my-leases/<id>` for a lease still in
  `AWAITING_SIGNATURES` see the new "Sign your lease" CTA;
  otherwise the page is unchanged.
