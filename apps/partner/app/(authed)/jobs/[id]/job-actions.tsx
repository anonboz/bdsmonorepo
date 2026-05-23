'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CreateMediaUploadResponse, MediaAsset, ServiceJob } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  MediaUploader,
  Spinner,
} from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

/** Concrete uploader-client bound to this app's typed api wrapper. */
const uploaderClient = {
  createUpload: (body: {
    purpose: 'CAMPAIGN_PHOTO' | 'JOB_PROOF';
    filename: string;
    contentType: string;
    sizeBytes: number;
  }) => api.post<CreateMediaUploadResponse>('/v1/media/uploads', body),
  confirmUpload: (assetId: string) => api.post<MediaAsset>(`/v1/media/uploads/${assetId}/confirm`),
};

type Action = 'quote' | 'start' | 'complete' | 'cancel';

/**
 * Partner-side action panel. Renders the buttons appropriate to the
 * current job status; the API enforces the same state machine on the
 * server so misclicks return a clean 422.
 */
export function JobActions({ job }: { job: ServiceJob }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('VND');
  const [proofUrls, setProofUrls] = useState<string[]>([]);
  const [uploaderBusy, setUploaderBusy] = useState(false);

  async function call(action: Action, body?: Record<string, unknown>): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      await api.post<ServiceJob>(`/v1/me/jobs/${job.id}/${action}`, body ?? {});
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : `${action} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function quote(): Promise<void> {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setError('Enter a non-negative amount.');
      return;
    }
    await call('quote', { amount: n, currency });
  }

  async function complete(): Promise<void> {
    await call('complete', proofUrls.length > 0 ? { proofPhotos: proofUrls } : {});
  }

  async function cancel(): Promise<void> {
    const reason = window.prompt('Reason for cancelling? (visible to the owner)');
    if (!reason?.trim()) return;
    await call('cancel', { reason: reason.trim() });
  }

  const canCancel =
    job.status === 'REQUESTED' ||
    job.status === 'QUOTED' ||
    job.status === 'ACCEPTED' ||
    job.status === 'IN_PROGRESS';

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {job.status === 'REQUESTED' && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Send a quote</p>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (minor units)"
              className="col-span-2"
            />
            <Input
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder="VND"
            />
          </div>
          <Button onClick={quote} disabled={busy != null}>
            {busy === 'quote' && <Spinner />}
            Send quote
          </Button>
        </div>
      )}

      {job.status === 'ACCEPTED' && (
        <Button onClick={() => call('start')} disabled={busy != null}>
          {busy === 'start' && <Spinner />}
          Start work
        </Button>
      )}

      {job.status === 'IN_PROGRESS' && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Mark complete</p>
          <p className="text-xs text-muted-foreground">
            Optional proof photos (up to 10). Uploaded directly to our storage.
          </p>
          <MediaUploader
            purpose="JOB_PROOF"
            maxFiles={10}
            onChange={setProofUrls}
            onBusyChange={setUploaderBusy}
            apiClient={uploaderClient}
          />
          <Button onClick={complete} disabled={busy != null || uploaderBusy}>
            {busy === 'complete' && <Spinner />}
            Mark complete
          </Button>
        </div>
      )}

      {canCancel && (
        <Button variant="destructive" onClick={cancel} disabled={busy != null}>
          {busy === 'cancel' && <Spinner />}
          Cancel
        </Button>
      )}

      {(job.status === 'COMPLETED' || job.status === 'RATED' || job.status === 'CANCELLED') && (
        <p className="text-sm text-muted-foreground">No further partner actions.</p>
      )}
    </div>
  );
}
