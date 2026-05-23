# Spec: Per-app photo upload UI (phase 10.1)

> Status: **shipped**
> Phase: 10
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8.4 shipped `POST /v1/media/uploads` + `/confirm` — the API
that returns a presigned PUT URL and verifies the upload landed.
None of the four PWAs use it. Owners still type photo URLs into a
comma-separated textarea on campaign create; partners do the same
on job completion. That worked for the CLI-only acceptance test in
8.4 but it's not shippable as v1 UX.

Phase 10.1 wires the file picker. The 8.4 endpoints don't change;
this is purely client work — one shared component + two app
wiring sites.

## 2. User stories

- As an **owner** drafting a campaign, I click "Add photos", pick
  a file (or several), and see thumbnail previews appear as each
  upload completes. The final campaign create POST sends the
  resulting `publicUrl` strings just like the old URL-textarea did.
- As a **partner** marking a job complete, I attach proof photos
  from my phone gallery; they upload while I keep filling in the
  rest of the form. Completion only fires when every upload has a
  confirmed URL.
- As a **user with a flaky connection**, when an upload fails I see
  the error inline next to the failing file + a retry button. The
  other files in the picker stay uploaded.

## 3. Surfaces

| Surface             | App / file                                                                                   | Notes                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Shared UI           | `packages/ui/src/components/media-uploader.tsx` (new)                                        | Client component running the 8.4 create → PUT → confirm dance.                                                          |
| Owner campaign form | `apps/owner/app/(authed)/houses/[id]/units/[unitId]/campaigns/_components/campaign-form.tsx` | Replaces the comma-separated textarea with `<MediaUploader purpose="CAMPAIGN_PHOTO" />`.                                |
| Partner job actions | `apps/partner/app/(authed)/jobs/[id]/job-actions.tsx`                                        | Replaces the proof-URL `<Input>` with `<MediaUploader purpose="JOB_PROOF" />` on the IN_PROGRESS → COMPLETE transition. |

No API changes. No schema changes. No new env vars.

## 4. The shared component

```tsx
// packages/ui/src/components/media-uploader.tsx

export interface MediaUploaderProps {
  /** Maps to MediaPurpose on the backend; same string literal. */
  purpose: 'CAMPAIGN_PHOTO' | 'JOB_PROOF';
  /** Existing URLs to pre-render (e.g. campaign in edit mode). */
  initial?: string[];
  /** Hard cap on total file count for the surface (e.g. 20 for a campaign). */
  maxFiles?: number;
  /** Fires every time the URL set changes (file finished uploading,
   *  file removed). Parent stores the current list + sends it on
   *  form submit; the uploader has no "save now" semantics. */
  onChange: (urls: string[]) => void;
  /**
   * The two functions the component needs to talk to the API.
   * Passed in by the parent rather than imported because each app
   * has its own `apiClient` instance (cookie scope, base URL).
   *
   * The signature is intentionally narrow — only what the upload
   * flow uses, not the full client.
   */
  apiClient: {
    createUpload(body: {
      purpose: 'CAMPAIGN_PHOTO' | 'JOB_PROOF';
      filename: string;
      contentType: string;
      sizeBytes: number;
    }): Promise<{
      assetId: string;
      uploadUrl: string;
      publicUrl: string;
      requiredHeaders: Record<string, string>;
    }>;
    confirmUpload(assetId: string): Promise<{ publicUrl: string }>;
  };
}
```

`@repo/ui` deliberately has no `fetch` of its own — that's why the
upload + confirm calls come in as `apiClient` props. The component
just orchestrates state + renders.

### 4.1 Internal state

```
type FileState =
  | { phase: 'idle';      file: File }
  | { phase: 'uploading'; file: File; progress: number }   // optional; phase-2 polish
  | { phase: 'confirming'; file: File }
  | { phase: 'done';      file: File; publicUrl: string }
  | { phase: 'error';     file: File; message: string }
  | { phase: 'persisted'; publicUrl: string }              // initial[] rows
```

The component starts with one `persisted` slot per `initial[]` entry.
Picking files appends `idle` slots; the uploader processes them
serially (one signed PUT at a time keeps the bandwidth predictable on
mobile).

`onChange` fires whenever a slot transitions to `done` / `persisted`
or gets removed, with the union of all `publicUrl`s. Slots in any
other phase don't contribute to the URL list yet.

### 4.2 File constraints

- Client-side: refuse `file.type` that doesn't start with `image/`.
- Client-side: refuse `file.size > 20 MB` (matches the 8.4 hard cap).
- Server-side: the `createUpload` call enforces the same; the UI
  message just makes the failure faster.

## 5. App wiring

### 5.1 Owner campaign form

Replace:

```tsx
<Textarea id="photos" {...form.register('photos')} ... />
```

With:

```tsx
<MediaUploader
  purpose="CAMPAIGN_PHOTO"
  initial={initial?.photos ?? []}
  maxFiles={20}
  onChange={(urls) => form.setValue('photos', urls.join(', '))}
  apiClient={uploaderClient}
/>
```

The form still stores `photos` as a comma-joined string internally
(no migration risk to the existing submit code) — the uploader's
`onChange` keeps the form state in sync.

### 5.2 Partner job-actions

Same shape, except the parent's local `proofUrls` state becomes an
array directly (since there's no react-hook-form here):

```tsx
const [proofUrls, setProofUrls] = useState<string[]>([]);
// ...
<MediaUploader
  purpose="JOB_PROOF"
  maxFiles={10}
  onChange={setProofUrls}
  apiClient={uploaderClient}
/>;
// ...
await call('complete', { proofPhotos: proofUrls });
```

Submit gates on "every slot is `done` / `persisted`" — the uploader
exposes that via the `onChange` (URL count) but the "is one
in-flight" signal needs a second callback. v1 keeps it simple: the
`Mark complete` button is disabled while any slot is in flight; the
uploader fires a second `onBusyChange(busy: boolean)` callback for
that.

## 6. Permissions

Inherited from 8.4 — the upload + confirm endpoints already require
an authenticated user; the URLs are scoped to the owner of the
asset. No new gates here.

## 7. Edge cases

- **User picks 30 files, max is 20**: the picker accepts the first
  20 + shows an inline warning. No silent drop.
- **User reloads mid-upload**: the slot is gone. The asset row is
  PENDING in DB; an 8.4 follow-up sweeper picks it up + deletes.
  v1 doesn't try to resume.
- **User removes a `done` file**: parent's URL list shrinks. The
  S3 object stays — orphaned. Acceptable for v1; the GDPR-erasure
  flow purges them at user-delete time. Image-processing pipeline
  (10.3) might also clean orphans as a follow-up.
- **Initial URLs from edit mode**: rendered as `persisted` slots.
  Removing one trims it from `onChange`; the underlying S3 object
  is **not** purged (same orphan story as above).
- **`apiClient` rejects (auth expired, 5xx)**: slot phase →
  `error`; user can retry the single file without affecting the
  others.

## 8. Out of scope

- **Upload progress bar**: nice-to-have but the 8.4 endpoint doesn't
  stream progress and `XMLHttpRequest` would replace `fetch` just
  for this. Defer.
- **Drag-and-drop reordering**: cards render in pick order; no
  reorder UI in v1.
- **Image processing (thumbnails, EXIF strip)**: that's Phase 10.3.
- **Multi-file concurrent uploads**: the uploader is serial in v1.
  Phase 10.3's image worker is the natural place to parallelise.
- **Inline crop / rotate**: no.
- **Ticket attachments**: the ticket spec doesn't have a `photos`
  field yet; lifting it through schema + tenant UI is heavier than
  this slice and deferred to a future polish item.

## 9. Acceptance criteria

- [ ] `packages/ui/src/components/media-uploader.tsx` ships +
      exports from the package's barrel.
- [ ] Owner campaign create + edit screens use the uploader; the
      old comma-separated textarea is removed.
- [ ] Partner job-actions "Mark complete" uses the uploader; the
      old comma-separated URL `<Input>` is removed.
- [ ] An upload of a non-image file is rejected client-side without
      a network call.
- [ ] Removing a successfully-uploaded file removes it from the
      submit payload (URL no longer in the array).
- [ ] `pnpm turbo typecheck` / `lint` clean.

## 10. Manual test plan

1. Start API + Owner app + MinIO locally.
2. Create a draft campaign; pick three photos via the file picker.
3. Watch each thumbnail appear in turn (serial upload).
4. Submit; verify the campaign's `photos` array has three S3 URLs.
5. Reopen for edit; the three thumbnails render via the
   `initial[]` path. Remove one + add a fourth; submit.
6. Confirm the final `photos` array has three URLs (two retained,
   one new).
7. Repeat steps 1–5 on the partner job-actions flow.

## 11. Rollout

- No DB migration.
- No env additions.
- No feature flag.
- Old URL-textarea is removed cleanly — the API still accepts the
  same shape, so any half-finished drafts from before this slice
  keep working.
