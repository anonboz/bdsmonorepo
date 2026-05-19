# Spec: bill receipt PDF (Phase 2.4)

> Status: **draft**
> Phase: 2
> Owner: —
> Spec last updated: 2026-05-19

## 1. Why

Tenants and owners both need a portable document of any bill they can email,
file with taxes, or hand to an accountant. The web UI is great for browsing
but it doesn't print well and can't be archived.

A PDF is the universal receipt format. We render it server-side so the
contents are guaranteed to match the DB (no client-side font/style
mismatches) and so it's straightforward to email later (Phase 2.6
reminders ship the PDF as an attachment).

## 2. User stories

- As a **tenant**, I want a "Download receipt" button on any bill so I have
  a portable record of what I owe / paid.
- As an **owner**, I want the same button on each bill so I can send it to
  the tenant or my accountant.

## 3. Screens

| Surface         | App    | Route                                                         | Notes                  |
| --------------- | ------ | ------------------------------------------------------------- | ---------------------- |
| Bill detail (T) | tenant | `/my-bills/[billId]`                                          | Add "Download receipt" |
| Bill detail (O) | owner  | `/houses/[id]/units/[unitId]/leases/[leaseId]/bills/[billId]` | Same button            |

Buttons are simple `<a download>` anchors — the browser handles the file
save. No client JS or modal.

## 4. API shape

| Method | Path                                                                      | Audience | Returns                        |
| ------ | ------------------------------------------------------------------------- | -------- | ------------------------------ |
| GET    | `/v1/me/bills/:id/receipt.pdf`                                            | TENANT   | `application/pdf` (`200`)      |
| GET    | `/v1/houses/:houseId/units/:unitId/leases/:leaseId/bills/:id/receipt.pdf` | OWNER    | `application/pdf` (`200`)      |
| ADMIN  | `/v1/houses/.../bills/:id/receipt.pdf`                                    | ADMIN    | same as owner route — read-any |

Headers:

```
Content-Type: application/pdf
Content-Disposition: attachment; filename="bill-<billId>-<periodStart>.pdf"
Cache-Control: private, no-store
X-Trace-Id: <req id>
```

Authorization reuses the existing `BillsService` checks — same code path
that powers the JSON read. Tenant can only download receipts for bills
attached to their own leases; owner only on their own houses; admin any.

## 5. Document layout

Single page, A4 / Letter agnostic (let pdfkit default).

```
┌─────────────────────────────────────────────────┐
│ BDS                                Bill receipt │
│                                                 │
│ Period: 2026-06-01 – 2026-06-30                 │
│ Due:    2026-06-08                              │
│ Status: ISSUED                                  │
│                                                 │
│ ─────────────────────────────────────────────── │
│ Owner:   Olivia Owner                           │
│ Tenant:  Tara Tenant                            │
│ Unit:    A1, Sunnyside Apartments               │
│          123 Sunny St, Hanoi, VN                │
│ ─────────────────────────────────────────────── │
│                                                 │
│ Item                       Qty       Amount     │
│ Rent · 2026-06-01–06-30      1   500,000 VND    │
│                                                 │
│                          Subtotal: 500,000 VND  │
│                             Total: 500,000 VND  │
│                                                 │
│ ─────────────────────────────────────────────── │
│ Generated 2026-05-19 14:30 UTC                  │
│ Trace: <traceId>                                │
└─────────────────────────────────────────────────┘
```

- Money formatting matches the rest of the app (integer minor units → ISO
  4217 formatted via Intl.NumberFormat — done in the helper, not in the
  layout code).
- Status reflects current state of the bill. PAID bills get a small "PAID"
  stamp top-right (faint green, no fancy graphics needed).
- We do **not** embed a logo image in this slice (none exists yet); the
  "BDS" header is just text in a bold sans-serif.

## 6. Implementation

- Library: **pdfkit** (`pdfkit@^0.15`). Pure Node, no headless browser. Pure
  streams API — we collect chunks into a Buffer in the service.
- Module: a small `BillsReceiptService` that takes a `Bill` (already loaded
  by `BillsService`) plus the joined lease + unit + house + tenant + owner
  rows, and emits a Buffer.
- Endpoint handlers stream the Buffer with the right headers via Fastify's
  reply API.

## 7. Edge cases

- **Bill not found / wrong tenant or owner** → 404, same as the JSON GET.
- **PDF render error** → 500 internal_error; the filter renders
  `application/problem+json` instead of a partial PDF.
- **Status changes between render requests** — receipts always reflect the
  current DB row, not a snapshot at issue time. Two downloads of the same
  bill can differ if status flipped (e.g., ISSUED → PAID). That's the
  right semantics for now.
- **Very long lease descriptions** — the spec ships with at most a RENT
  line; if 2.3b adds many ad-hoc lines, we paginate (overflow to a
  second page). Out of scope here.

## 8. Out of scope

- **Logo image / branded header** — needs design.
- **Multi-language receipts** — needs i18n setup (open in BUILD_PLAN §8).
- **Email attachment** — Phase 2.6 with reminders.
- **Signed download links** (S3-style pre-signed URL) — out of scope; we
  authorize on the request directly via the session cookie.
- **Cached receipts** — we re-render on every request. Cheap; one bill =
  ~10 ms to render.

## 9. Acceptance criteria

- [ ] Tenant downloads their own bill's PDF from `/v1/me/bills/:id/receipt.pdf`;
      file opens in any PDF reader with no errors.
- [ ] Tenant trying another tenant's bill → 404.
- [ ] Owner downloads from the nested route; admin can too.
- [ ] PDF includes: period, due date, status, owner name, tenant name,
      unit + house address, line items table, subtotal/total.
- [ ] Content-Disposition uses `attachment` + a meaningful filename.
- [ ] Generated PDF is < 30 KB for the typical one-line bill (sanity check).
- [ ] All 33 turbo tasks stay green.

## 10. Manual test plan

1. Boot the API + tenant dev server.
2. Sign in as `tenant1@example.com`, open `/my-bills`, pick the latest
   bill.
3. Click "Download receipt" → file `bill-<id>-2026-06-01.pdf` lands in
   Downloads.
4. Open the file — verify period, due date, status, names, address,
   total all match the UI.
5. Repeat as `owner1@example.com` from the owner side.
6. Sign out, hit `/v1/me/bills/<someBillId>/receipt.pdf` directly in
   browser → redirected to /login (auth gate).

## 11. Rollout

- No DB migration.
- No new env vars.
- No feature flag — pure additive.
