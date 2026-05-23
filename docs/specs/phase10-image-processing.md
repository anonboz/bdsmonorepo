# Spec: Image processing pipeline (phase 10.3)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8.4 shipped raw upload + confirm. Two consequences:

- **EXIF leaks PII.** A campaign photo from a phone embeds GPS
  coordinates, the device serial, and a creation timestamp. We're
  surfacing that publicly via the campaign listing every time an
  owner uploads from their phone gallery.
- **No thumbnails.** The inbox card, the listing tile, the
  job-detail card all render the full-resolution source. A 5MB
  phone photo hammers mobile data; the owner's house listing
  drags loading on every viewer.

Phase 10.3 closes the 8.4 polish item: a BullMQ worker fires after
`media.confirm` lands the row UPLOADED, reads the bytes back from
S3, strips EXIF, and writes a 320px thumbnail variant. The
`MediaAsset` row gains a `thumbnailUrl` consumers can opt in to.

It also closes the "byte-level enforcement" gap: 8.4's confirm
only compares actual size vs. declared, not against an absolute
ceiling. A client that _declares_ 18MB upfront passes Zod's
`MAX_UPLOAD_BYTES` then uploads 18MB and gets confirmed. The
processing worker is the first place we have the bytes in hand, so
it's the right place to reject anything that wandered past the
hard cap _after_ EXIF strip.

## 2. User stories

- As an **owner** browsing a public listing, thumbnails render
  fast on a 3G connection because the listing tiles use the
  thumbnail variant, not the full photo.
- As a **tenant** worried about location privacy, when a partner
  uploads job-proof photos from a phone the photo lands in S3
  without GPS coords or the device serial.
- As **ops**, when processing fails I can read `processingFailureReason`
  on the MediaAsset row + see a `media.process.failed` audit row
  without digging through Sentry first.
- As a **client**, when I render an image I fall back to the
  original `publicUrl` if `thumbnailUrl` is null (processing not
  yet finished, or row from before this phase shipped).

## 3. Surfaces

| Surface       | App / file                                    | Notes                                                                                                 |
| ------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| BullMQ worker | `apps/api/src/media/media.processor.ts` (new) | Pulls `media.process` jobs; pure worker (no scheduler — confirm enqueues directly).                   |
| Service       | `apps/api/src/media/media.service.ts`         | `confirmUpload` post-tx enqueues `media.process`; new `processAsset(assetId)` method does the work.   |
| Schema        | `packages/db/prisma/schema.prisma`            | `MediaAsset.thumbnailUrl`, `thumbnailKey`, `processedAt`, `processingFailureReason`. Status REJECTED. |
| Shared types  | `packages/shared/src/schemas/media.ts`        | `MediaAsset.thumbnailUrl` (optional). New status enum value.                                          |
| Queue names   | `apps/api/src/queues/queue-names.ts`          | `QUEUE_MEDIA_PROCESS`, `JOB_MEDIA_PROCESS`, `MediaProcessJobData`.                                    |
| Metrics       | `apps/api/src/admin/admin-metrics.service.ts` | `media.process` queue counts.                                                                         |
| Dependency    | `apps/api/package.json`                       | Direct `sharp` dependency (already a transitive via playwright).                                      |

No HTTP route additions. Existing `/v1/media/uploads/:id/confirm`
return shape gains an optional `thumbnailUrl`.

## 4. API shape

```ts
// packages/shared/src/schemas/media.ts
export const mediaAssetSchema = z.object({
  // ...existing fields unchanged...
  /** Set by the image processor (Phase 10.3) once the thumbnail
   *  variant is in S3. Null while processing is in flight, or for
   *  rows that pre-date the worker. Clients fall back to publicUrl. */
  thumbnailUrl: z.string().url().nullable(),
});

export const MediaStatus = {
  // ...existing values...
  /** Set by the image processor when the actual bytes exceed
   *  MAX_UPLOAD_BYTES after EXIF strip, or processing failed past
   *  the worker's retry cap. The S3 object is purged; the row stays
   *  for audit / link integrity. */
  REJECTED: 'REJECTED',
} as const;
```

Job payload:

```ts
// apps/api/src/queues/queue-names.ts
export interface MediaProcessJobData {
  assetId: string;
}
```

## 5. Data model changes

```prisma
model MediaAsset {
  // ...existing fields unchanged...

  /// Phase 10.3 — populated by the image processor. Null while
  /// processing is in flight or for pre-10.3 rows.
  thumbnailUrl String? @db.VarChar(800)
  thumbnailKey String? @db.VarChar(500)

  /// Phase 10.3 — set when processing finishes, regardless of
  /// outcome. Combined with `processingFailureReason` tells ops
  /// whether the asset survived.
  processedAt DateTime?

  /// Phase 10.3 — set on the failure path (oversize, S3 read fail
  /// past retries). Sibling of NotificationsSweeper.failureReason.
  processingFailureReason String? @db.VarChar(2000)
}

enum MediaStatus {
  PENDING
  UPLOADED
  DELETED
  /// Phase 10.3 — bytes were over the hard cap after EXIF strip or
  /// the processor gave up. The S3 source is purged; the row
  /// stays for audit.
  REJECTED
}
```

Migration name: `media_asset_processing`.

The status column is an enum so the migration needs the standard
two-step add-value dance; we add it via plain `ALTER TYPE` (forward-
only) and the existing `DELETED` value covers the cleanup story for
purged data.

## 6. Workers / jobs

New queue `media.process` registered in QueuesModule. **No
scheduler** — unlike the bills / payouts / stuck-notifications
sweepers, processing is triggered directly by `confirmUpload` after
the row commits UPLOADED.

Worker behaviour:

1. Pull `MediaAsset` row + early-bail if `processedAt` is set or
   the status is no longer `UPLOADED`. (Re-running a successful job
   on a row that was already processed is a no-op.)
2. `GetObject` the bytes from S3.
3. **EXIF strip + variant generation** via `sharp`:
   - Re-encode the source to the same MIME type (JPEG → JPEG,
     PNG → PNG). Sharp's default re-encode drops EXIF without
     us asking explicitly.
   - Resize to a 320×320 inscribed `fit: 'inside'` thumbnail at
     quality 75 JPEG.
4. **Byte-level reject:** if the stripped source exceeds
   `MAX_UPLOAD_BYTES` (20 MiB), the worker:
   - `DeleteObject` the original from S3.
   - Set status `REJECTED`, write `processingFailureReason`.
   - Audit `media.process.rejected`.
   - Return early; no thumbnail emitted.
5. **Happy path:**
   - `PutObject` the stripped variant back to the original key.
   - `PutObject` the thumbnail to `${originalKey}.thumb.jpg`.
   - Set `thumbnailUrl`, `thumbnailKey`, `processedAt = now()`.
   - Audit `media.process.completed` (one row per successful run).
6. **Retry policy:** BullMQ attempts 3 with exponential backoff
   (2s / 4s / 8s). After max attempts the `onFailed` hook lands
   the error message on `processingFailureReason` so ops greps
   one column — same pattern as `NotificationsSendWorker.onFailed`.

### Idempotency

Re-runs are safe:

- `processedAt != null` → worker returns `{ status: 'already-processed' }`.
- Status `REJECTED` → worker returns `{ status: 'already-rejected' }`.
- `PutObject` is the only write step and overwrites by key — re-
  running won't duplicate.

### API_DISABLE_QUEUES guard

Worker class isn't registered in providers when the env is set.
Confirm endpoint still tries to enqueue; the producer-side catch
swallows the error so dispatch never throws into the confirm path.

## 7. Permissions

System-owned; audit rows have null `actorId`.

## 8. Edge cases

- **Non-image content type (slipped past Zod):** sharp throws on
  `.metadata()`. Caught + escalated as `processingFailureReason`
  rather than retried forever — the input is broken regardless of
  retry count.
- **Animated GIF or multi-frame source:** sharp returns the first
  frame for the thumbnail. Acceptable for v1; a follow-up could
  emit a per-frame variant or skip animated entries.
- **EXIF orientation flag:** sharp re-encodes with the visual
  orientation baked in; we lose the flag but the rendered image
  looks correct in every browser. No EXIF survives the re-encode
  → no GPS leaks.
- **Worker dies mid-`PutObject`:** the row stays `UPLOADED` with
  `processedAt = null`. BullMQ re-attempts; if the second
  attempt's `PutObject` overwrites the partial body, we're fine.
- **User erases account mid-process:** the row's `deletedAt` is
  set + S3 key purged by the 9.3 erasure flow. Worker's early-
  bail check (`status !== UPLOADED`) catches this; nothing leaks.
- **CDN cache:** `publicUrl` doesn't change (we overwrite the same
  key), so any CDN holding the pre-strip variant serves it until
  TTL elapses. Documented in the runbook; v1 doesn't bust caches
  because no CDN is wired yet.

## 9. Out of scope

- **Multiple thumbnail sizes** (e.g. small/medium/large). One
  320px variant for v1; the listing surfaces all use the same
  card size.
- **AVIF / WebP variants** for bandwidth savings. JPEG is
  universally supported; format negotiation is a follow-up.
- **Background processing of pre-10.3 rows.** Existing rows ship
  without thumbnails forever (or until an owner edits the
  campaign + re-uploads). A backfill script is a separate one-off,
  not part of this slice.
- **Aggressive size compression on the original.** We only strip
  EXIF + re-encode at sharp's default quality; we don't try to
  drive the bytes down further. Phase 10.3 isn't a compression
  feature.
- **Per-asset processing audit history.** One success or one
  failure row per asset; we don't trace retries individually.
  BullMQ's job log is the inspection surface for that.

## 10. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean.
- [ ] Migration adds the four new columns + REJECTED enum value
      cleanly on a fresh DB.
- [ ] `MediaService.processAsset` unit-tested for: happy path
      (status unchanged, thumbnailUrl set, processedAt set),
      oversized-after-strip reject (status REJECTED, S3 delete
      called, no thumbnail emitted), idempotent re-run (no-op
      on already-processed row), non-UPLOADED bail.
- [ ] `MediaService.confirmUpload` enqueues `media.process` after
      the row commits UPLOADED. Spec verifies the queue add fires
      exactly once + only on the UPLOADED transition.
- [ ] `/v1/admin/metrics` includes `media.process` in the queue
      list.
- [ ] `sharp` is declared as a direct dep of `apps/api`.

## 11. Manual test plan

1. Start the API + a real MinIO + a real Redis worker.
2. Upload a JPEG with embedded EXIF GPS from a phone via the
   owner campaign form.
3. Wait ≤ 5s; refresh the asset's row in Prisma Studio.
4. Confirm `processedAt` is set + `thumbnailUrl` is populated.
5. Re-download the original from `publicUrl`; `exiftool` against
   the file shows zero GPS / device tags.
6. Hit `thumbnailUrl` in the browser: a ~30KB image renders.
7. **Reject path:** upload a 22MB image (server's Zod accepts
   because it's <20 MiB after the client may have lied on
   declared size). Confirm; the worker's byte check tips it over;
   row flips to REJECTED, S3 key purged.

## 12. Rollout

- Forward-only Prisma migration — all new columns nullable; new
  enum value is additive.
- New direct dep `sharp` — pnpm picks the already-resolved
  transitive, no install size change.
- No feature flag; the worker is on by default. `API_DISABLE_QUEUES`
  skips registration in unit-test environments.
- Pre-10.3 rows ship with `thumbnailUrl = null` and `processedAt = null`;
  clients fall back to `publicUrl` as documented in §4.
