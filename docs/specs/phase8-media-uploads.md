# Spec: S3 media uploads (phase 8.4)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-21

## 1. Why

Campaign photos (Phase 4.3) and partner proof-of-work photos (Phase 5.2)
both shipped as `String[]` columns holding **external** URLs the client
supplied (image hosting on someone else's box, copy-pasted into the
form). That's brittle (link rot), unverifiable (no checksum, no
content-type), and unrevokable (we can't expire access on user delete).

Phase 8.4 wires our own S3 backing via MinIO locally and a real S3
bucket in prod. The client requests a **pre-signed PUT URL** from the
API, uploads the file directly to S3 from the browser, then calls a
**confirm** endpoint. The API issues a canonical public URL that the
existing `photos` / `proofPhotos` arrays can hold without any schema
change to those columns — uploads compose on top of the current shape
instead of replacing it.

A new `MediaAsset` row tracks every uploaded blob so we can revoke
(delete from S3, mark `deletedAt` on the row) when a user is erased.

## 2. User stories

- As a **partner**, after marking a job complete I attach photos via
  the file picker; they upload to S3 in the background and the job's
  `proofPhotos` array updates with the canonical URLs.
- As an **owner**, when creating a campaign I upload listing photos
  the same way; the URLs end up in `campaign.photos`.
- As an **operator**, every uploaded file has a `MediaAsset` row with
  `ownerUserId`, bucket, key and a `sizeBytes` so I can run
  `findFirst({ sizeBytes: { gt: 50 * 1024 * 1024 } })` to spot abuse.
- As **legal**, when a user is deleted, the operator runs a script
  that flips every owned MediaAsset to `deletedAt: now()` + issues an
  S3 delete-object. The public URL stops working.

## 3. Screens / surfaces

| Surface         | App / file                             | Notes                                                                                                    |
| --------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Storage service | `apps/api/src/common/storage/`         | Wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Works against MinIO locally.               |
| Media API       | `apps/api/src/media/`                  | `POST /v1/media/uploads` → signed PUT; `POST /v1/media/uploads/:id/confirm` → finalize.                  |
| Shared schemas  | `packages/shared/src/schemas/media.ts` | `mediaAssetSchema`, create/confirm request + response.                                                   |
| Env additions   | `apps/api/src/env.ts`                  | `S3_*` settings + dev defaults pointing at MinIO.                                                        |
| Frontend wiring | _not in 8.4_                           | Per-app upload UI is a follow-up. v1 backend is sufficient for an API consumer (CLI, integration tests). |

## 4. API shape

```ts
// packages/shared/src/schemas/media.ts

export const MediaPurpose = {
  CAMPAIGN_PHOTO: 'campaign_photo',
  JOB_PROOF: 'job_proof',
} as const;
export type MediaPurpose = (typeof MediaPurpose)[keyof typeof MediaPurpose];
export const mediaPurposeSchema = z.nativeEnum(MediaPurpose);

export const MediaStatus = {
  PENDING: 'PENDING',
  UPLOADED: 'UPLOADED',
  DELETED: 'DELETED',
} as const;
export type MediaStatus = (typeof MediaStatus)[keyof typeof MediaStatus];
export const mediaStatusSchema = z.nativeEnum(MediaStatus);

export const createMediaUploadSchema = z.object({
  purpose: mediaPurposeSchema,
  filename: z.string().min(1).max(200),
  contentType: z
    .string()
    .min(1)
    .max(120)
    .refine((c) => c.startsWith('image/'), 'only image/* is allowed in v1'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024), // 20 MiB hard cap
});

export const createMediaUploadResponseSchema = z.object({
  assetId: idSchema,
  uploadUrl: z.string().url(),
  uploadUrlExpiresAt: isoDateTimeSchema,
  publicUrl: z.string().url(),
  // The HTTP headers the client MUST send on the PUT — S3 enforces an
  // exact match against the policy, so the server tells the client
  // what to use.
  requiredHeaders: z.record(z.string(), z.string()),
});

export const mediaAssetSchema = z.object({
  id: idSchema,
  ownerUserId: idSchema,
  purpose: mediaPurposeSchema,
  status: mediaStatusSchema,
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  publicUrl: z.string().url(),
  filename: z.string(),
  createdAt: isoDateTimeSchema,
  uploadedAt: isoDateTimeSchema.nullable(),
});
```

Endpoints (under `/v1/media`, all behind AuthGuard; all four roles can
upload but each MediaAsset is scoped to `ownerUserId === actor.id`):

| Method | Path                            | Roles | Description                                                                              |
| ------ | ------------------------------- | ----- | ---------------------------------------------------------------------------------------- |
| POST   | `/v1/media/uploads`             | any   | Creates a `PENDING` MediaAsset row + returns a signed PUT URL valid for 5 minutes.       |
| POST   | `/v1/media/uploads/:id/confirm` | any   | Marks the asset `UPLOADED`. HEAD-checks the bucket to verify the upload actually landed. |
| GET    | `/v1/media/:id`                 | any   | Returns the asset row (without re-signing). Cross-user ids → 404.                        |

No DELETE in this slice — revocation flows through the GDPR-erasure
script when that lands. The MediaAsset row carries `deletedAt` so the
column is ready.

## 5. Data model changes

```prisma
enum MediaPurpose {
  CAMPAIGN_PHOTO
  JOB_PROOF
}

enum MediaStatus {
  PENDING   // signed PUT issued, not yet confirmed
  UPLOADED  // confirm endpoint verified the blob exists
  DELETED   // S3 object purged; row kept as audit
}

model MediaAsset {
  id          String       @id @default(cuid())
  ownerUserId String
  owner       User         @relation(fields: [ownerUserId], references: [id], onDelete: Cascade)

  purpose     MediaPurpose
  status      MediaStatus  @default(PENDING)

  /// "s3" today; reserved for future providers (e.g. cloudflare R2).
  provider    String       @db.VarChar(20) @default("s3")
  bucket      String       @db.VarChar(120)
  key         String       @db.VarChar(500)

  filename    String       @db.VarChar(200)
  contentType String       @db.VarChar(120)
  sizeBytes   Int          @default(0)

  /// Cached canonical URL clients should embed. May be a public-read
  /// path or a CDN-fronted URL — depends on deploy config. Stored so
  /// callers don't have to re-derive it.
  publicUrl   String       @db.VarChar(800)

  uploadedAt  DateTime?
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt
  deletedAt   DateTime?

  @@index([ownerUserId, createdAt])
  @@index([status, createdAt])
  @@index([provider, bucket, key])
}
```

Migration name: `media_assets`. Adds the two enums + the table. No
backfill — existing `photos` / `proofPhotos` URLs stay where they are.

## 6. Storage service

`apps/api/src/common/storage/storage.service.ts`:

```ts
@Injectable()
export class StorageService {
  buildKey(purpose: MediaPurpose, ownerUserId: string, ext: string): string;

  /**
   * Issues a `PutObject` signed URL valid for ~5 minutes. Caller MUST
   * send `Content-Type: <contentType>` matching the param exactly.
   */
  presignPut(input: {
    bucket: string;
    key: string;
    contentType: string;
    expiresInSec?: number;
  }): Promise<{ url: string; expiresAt: Date; requiredHeaders: Record<string, string> }>;

  /** HEAD-checks the object exists + returns its size. */
  headObject(input: { bucket: string; key: string }): Promise<{ sizeBytes: number } | null>;

  /** Public URL the client embeds. Resolves via env override; on MinIO,
   *  the bucket is anonymous-read so the canonical URL is `${endpoint}/${bucket}/${key}`. */
  publicUrl(bucket: string, key: string): string;
}
```

Backed by `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. The
client config reads `S3_ENDPOINT` / `S3_REGION` / `S3_ACCESS_KEY_ID` /
`S3_SECRET_ACCESS_KEY` / `S3_BUCKET_UPLOADS` / `S3_FORCE_PATH_STYLE`
from env. Defaults point at the local MinIO config in
`docker-compose.yml`.

### Tests

Unit tests stub the `StorageService` entirely — no MinIO container is
spun up. `presignPut` returns a deterministic URL; `headObject` is a
vi.fn that the test sets up per-case. The MinIO defaults in
`docker-compose.yml` cover the local-dev path; in CI the e2e job
already brings MinIO up alongside Postgres.

## 7. Confirm flow

```
1. Client → POST /v1/media/uploads { purpose, filename, contentType, sizeBytes }
2. API   → INSERT MediaAsset (status PENDING, key derived) + sign PUT
3. API   → 200 { assetId, uploadUrl, requiredHeaders, publicUrl }
4. Client → PUT <uploadUrl>  Content-Type: <contentType>  (binary body)
5. Client → POST /v1/media/uploads/:assetId/confirm
6. API   → HEAD s3://bucket/key — verify object exists + size ≤ row's sizeBytes
7. API   → UPDATE MediaAsset status=UPLOADED, uploadedAt=now()
8. API   → 200 { mediaAsset }
9. Client → embeds publicUrl in the campaign / job mutation
```

If step 6 fails (object not present, wrong size), API returns 422
`media.upload_not_found` and the row stays PENDING. A future sweeper
can clean up PENDING rows older than 24h.

## 8. Permissions

- **Create**: any authenticated role.
- **Confirm**: only the asset's `ownerUserId` can confirm. 404 on
  cross-user (existence-hiding).
- **Read**: only `ownerUserId` for the metadata endpoint. The
  `publicUrl` itself is public-read (MinIO bucket is `anonymous=download`
  in dev; prod bucket is CDN-fronted with the same model).
- **Use in domain mutations**: when a partner submits `proofPhotos`
  with our S3 URLs, the existing photos array validator accepts them
  the same way it accepts external URLs. The MediaAsset link is
  one-way: the URL string in the column is the source of truth for
  rendering; the MediaAsset row is the source of truth for ownership
  and revocation.

## 9. Edge cases

- **Client uploads to S3 but never confirms**: row sits PENDING. Out
  of scope for this slice; a sweeper job deletes PENDING > 24h.
- **Wrong content-type on PUT**: S3 rejects the upload (signed policy
  pins the header). API never sees it; subsequent confirm 422s on
  HEAD miss.
- **Size mismatch**: confirm endpoint checks `headObject.contentLength
<= row.sizeBytes`. We accept smaller (client over-estimated) but
  reject larger. Prevents the "I said 1MB but uploaded 5GB" attack.
- **Path traversal in filename**: key derivation strips/escapes
  before composing the S3 key. Test covers `../` and `\0`.
- **Same key collision**: keys are derived from `cuid()` so
  collisions are vanishingly unlikely; we don't pre-check.
- **MinIO endpoint differs from public URL**: in prod we may want
  S3 ingress via CloudFront. `S3_PUBLIC_BASE` env override controls
  the embed URL independently of the SDK endpoint.

## 10. Out of scope

- **Per-app upload UI**: a Phase 8.4 follow-up. Once the API is
  shippable, each app's existing photo-URL field can grow a file
  picker that drives the create→PUT→confirm dance. The backend is
  framework-agnostic; CLI / curl integration tests are sufficient
  for the v1 acceptance.
- **Image processing** (thumbnails, EXIF strip, virus scan): we
  trust the uploaded bytes in v1. A BullMQ post-confirm job is the
  natural extension point and lives in a polish slice.
- **MediaAsset FK arrays on Campaign/ServiceJob**: keep `photos
String[]` + `proofPhotos String[]` as URL strings for now; the
  MediaAsset row links **back** via the URL pattern, not via FK. A
  forward-only migration to FK arrays is a follow-up if the
  one-to-many access pattern needs it (e.g. for thumbnail joins).
- **Direct-from-storage download endpoint**: callers use the
  `publicUrl` directly. Private buckets + signed GET requests can
  land later if any asset class becomes confidential.

## 11. Acceptance criteria

- [ ] `MediaAsset` model + `MediaPurpose` + `MediaStatus` enums in the
      Prisma schema; migration applies cleanly.
- [ ] `StorageService` exposes `presignPut` + `headObject` +
      `publicUrl`; unit tests stub the SDK and the controller wires
      them through the service.
- [ ] `POST /v1/media/uploads` returns 200 with `uploadUrl`,
      `publicUrl`, `requiredHeaders`, and persists a `PENDING` row.
- [ ] `POST /v1/media/uploads/:id/confirm` HEAD-checks S3 and flips
      to `UPLOADED`; 422 when the blob isn't present; 404 on
      cross-user ids.
- [ ] `GET /v1/media/:id` returns the row; 404 on cross-user ids.
- [ ] Unit tests stub the S3 SDK + assert: create returns row +
      signed URL; confirm verifies blob; key derivation is
      collision-safe + sanitises filename.

## 12. Manual test plan

1. Boot `docker compose up -d` so MinIO is running on 9000.
2. Hit `POST /v1/media/uploads` with the dev cookie. Inspect the
   response: should include a presigned URL for the MinIO bucket.
3. `curl -X PUT <uploadUrl> -H 'Content-Type: image/jpeg' --data-binary
@./test.jpg` — receives 200 from MinIO.
4. `POST /v1/media/uploads/:id/confirm` — receives 200 + asset row.
5. `curl <publicUrl>` — returns the binary; verify image renders in
   a browser.
6. Repeat with `purpose: job_proof` and confirm the row has the
   right purpose enum.

## 13. Rollout

- No feature flag; the endpoints are additive.
- Migration is additive (new table only).
- Env defaults already point at MinIO; new deployments need to set
  `S3_ENDPOINT` / `S3_BUCKET_UPLOADS` to their managed bucket.
- No data backfill.
