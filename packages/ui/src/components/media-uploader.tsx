'use client';

import * as React from 'react';

import { Alert, AlertDescription } from './alert';
import { Button } from './button';
import { cn } from '../lib/cn';

/**
 * Hard cap from Phase 8.4's `MAX_UPLOAD_BYTES`. Mirrored here so the
 * client can reject pre-network — keeps the component self-contained
 * + the API still re-checks.
 */
const MAX_BYTES = 20 * 1024 * 1024;

export type MediaUploaderPurpose = 'CAMPAIGN_PHOTO' | 'JOB_PROOF';

export interface MediaUploaderApiClient {
  createUpload(body: {
    purpose: MediaUploaderPurpose;
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
}

export interface MediaUploaderProps {
  purpose: MediaUploaderPurpose;
  /** Existing URLs to pre-render (e.g. campaign edit mode). */
  initial?: string[];
  /** Hard cap on total file count for the surface. */
  maxFiles?: number;
  /** Fires whenever the URL set changes (finish, remove). */
  onChange: (urls: string[]) => void;
  /** Fires when any slot is in-flight; the parent disables submit. */
  onBusyChange?: (busy: boolean) => void;
  apiClient: MediaUploaderApiClient;
  className?: string;
}

type Slot =
  | { id: string; phase: 'persisted'; publicUrl: string }
  | { id: string; phase: 'uploading'; filename: string }
  | { id: string; phase: 'done'; filename: string; publicUrl: string }
  | { id: string; phase: 'error'; filename: string; message: string };

let slotCounter = 0;
function nextSlotId(): string {
  slotCounter += 1;
  return `slot_${slotCounter}`;
}

/**
 * File picker + uploader. Runs the 8.4 create → PUT → confirm dance
 * one file at a time so the bandwidth profile is predictable on
 * mobile, and so an early failure surfaces inline next to the
 * affected file without rolling back the others.
 *
 * The component is presentation-only re: API surface — it doesn't
 * own its own `fetch`. Callers pass an `apiClient` so the per-app
 * cookie / base-URL setup is the parent's call.
 */
export const MediaUploader = React.forwardRef<HTMLDivElement, MediaUploaderProps>(
  ({ purpose, initial, maxFiles, onChange, onBusyChange, apiClient, className }, ref) => {
    const [slots, setSlots] = React.useState<Slot[]>(() =>
      (initial ?? []).map((url) => ({ id: nextSlotId(), phase: 'persisted', publicUrl: url })),
    );
    const [globalError, setGlobalError] = React.useState<string | null>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    // Re-publish the URL list every time slots change. Only `persisted`
    // + `done` slots contribute — in-flight uploads aren't a URL yet.
    React.useEffect(() => {
      const urls = slots
        .map((s) => {
          if (s.phase === 'persisted') return s.publicUrl;
          if (s.phase === 'done') return s.publicUrl;
          return null;
        })
        .filter((u): u is string => u !== null);
      onChange(urls);
      const busy = slots.some((s) => s.phase === 'uploading');
      onBusyChange?.(busy);
    }, [slots, onChange, onBusyChange]);

    async function uploadOne(file: File, slotId: string): Promise<void> {
      try {
        const created = await apiClient.createUpload({
          purpose,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
        const putRes = await fetch(created.uploadUrl, {
          method: 'PUT',
          headers: created.requiredHeaders,
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`upload PUT failed: HTTP ${putRes.status}`);
        }
        await apiClient.confirmUpload(created.assetId);
        setSlots((cur) =>
          cur.map((s) =>
            s.id === slotId
              ? { id: s.id, phase: 'done', filename: file.name, publicUrl: created.publicUrl }
              : s,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setSlots((cur) =>
          cur.map((s) =>
            s.id === slotId ? { id: s.id, phase: 'error', filename: file.name, message } : s,
          ),
        );
      }
    }

    async function handleFiles(files: FileList | null): Promise<void> {
      setGlobalError(null);
      if (!files || files.length === 0) return;

      // Surface-level filtering. The API re-checks; this is just to
      // give a fast inline reject without a network roundtrip.
      const accepted: File[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          setGlobalError(`"${file.name}" isn't an image. Only image files are allowed.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          setGlobalError(`"${file.name}" is larger than 20 MB.`);
          continue;
        }
        accepted.push(file);
      }
      if (accepted.length === 0) return;

      // Enforce maxFiles by trimming the new picks. Existing slots
      // (persisted + done) count against the cap.
      const remaining =
        typeof maxFiles === 'number'
          ? Math.max(0, maxFiles - slots.filter((s) => s.phase !== 'error').length)
          : accepted.length;
      const toUpload = accepted.slice(0, remaining);
      if (toUpload.length < accepted.length) {
        setGlobalError(
          `Only ${remaining} more file(s) allowed (max ${maxFiles}). Extra files were skipped.`,
        );
      }

      // Append optimistic uploading slots, then process serially.
      const newSlots: Slot[] = toUpload.map((file) => ({
        id: nextSlotId(),
        phase: 'uploading',
        filename: file.name,
      }));
      setSlots((cur) => [...cur, ...newSlots]);
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        const slot = newSlots[i];
        if (!file || !slot) continue;
        await uploadOne(file, slot.id);
      }

      // Reset the input so the same file can be picked again.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function removeSlot(id: string): void {
      setSlots((cur) => cur.filter((s) => s.id !== id));
    }

    function retrySlot(slot: Slot): void {
      if (slot.phase !== 'error') return;
      // Errored slots don't keep the File around (React state is
      // serializable). The user re-picks from disk to retry; we just
      // remove the failed slot so the next file picker click feels
      // clean.
      removeSlot(slot.id);
      fileInputRef.current?.click();
    }

    const canAdd = typeof maxFiles !== 'number' || slots.length < maxFiles;

    return (
      <div ref={ref} className={cn('space-y-3', className)}>
        {globalError && (
          <Alert variant="destructive">
            <AlertDescription>{globalError}</AlertDescription>
          </Alert>
        )}

        {slots.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {slots.map((slot) => (
              <li key={slot.id} className="relative">
                <SlotCard
                  slot={slot}
                  onRemove={() => removeSlot(slot.id)}
                  onRetry={() => retrySlot(slot)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={!canAdd}
            onChange={(e) => void handleFiles(e.currentTarget.files)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
          />
          {typeof maxFiles === 'number' && (
            <span className="flex-none text-xs text-muted-foreground">
              {slots.length}/{maxFiles}
            </span>
          )}
        </div>
      </div>
    );
  },
);
MediaUploader.displayName = 'MediaUploader';

function SlotCard({
  slot,
  onRemove,
  onRetry,
}: {
  slot: Slot;
  onRemove: () => void;
  onRetry: () => void;
}): React.ReactElement {
  const previewSrc = slot.phase === 'persisted' || slot.phase === 'done' ? slot.publicUrl : null;
  const label =
    slot.phase === 'persisted'
      ? 'Saved'
      : slot.phase === 'done'
        ? 'Uploaded'
        : slot.phase === 'uploading'
          ? 'Uploading…'
          : 'Failed';
  const subline = slot.phase === 'persisted' ? '' : slot.filename;

  return (
    <div className="overflow-hidden rounded-md border bg-card text-card-foreground">
      <div className="aspect-square bg-muted">
        {previewSrc ? (
          <img src={previewSrc} alt={subline || label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {label}
          </div>
        )}
      </div>
      <div className="space-y-1 p-2 text-xs">
        <p className="truncate font-medium">{subline || label}</p>
        {slot.phase === 'error' && (
          <p className="truncate text-destructive" title={slot.message}>
            {slot.message}
          </p>
        )}
        <div className="flex gap-2">
          {slot.phase === 'error' && (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          )}
          {slot.phase !== 'uploading' && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
