'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('partner.jobs.actions');
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
      setError(err instanceof ApiError ? err.problem.title : t('actionFailed', { action }));
    } finally {
      setBusy(null);
    }
  }

  async function quote(): Promise<void> {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      setError(t('enterAmountError'));
      return;
    }
    await call('quote', { amount: n, currency });
  }

  async function complete(): Promise<void> {
    await call('complete', proofUrls.length > 0 ? { proofPhotos: proofUrls } : {});
  }

  async function cancel(): Promise<void> {
    const reason = window.prompt(t('cancelPrompt'));
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
          <AlertTitle>{t('failedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {job.status === 'REQUESTED' && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('sendQuoteTitle')}</p>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t('amountPlaceholder')}
              className="col-span-2"
            />
            <Input
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              placeholder={t('currencyPlaceholder')}
            />
          </div>
          <Button onClick={quote} disabled={busy != null}>
            {busy === 'quote' && <Spinner />}
            {t('sendQuoteButton')}
          </Button>
        </div>
      )}

      {job.status === 'ACCEPTED' && (
        <Button onClick={() => call('start')} disabled={busy != null}>
          {busy === 'start' && <Spinner />}
          {t('startButton')}
        </Button>
      )}

      {job.status === 'IN_PROGRESS' && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('markCompleteTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('proofHint')}</p>
          <MediaUploader
            purpose="JOB_PROOF"
            maxFiles={10}
            onChange={setProofUrls}
            onBusyChange={setUploaderBusy}
            apiClient={uploaderClient}
          />
          <Button onClick={complete} disabled={busy != null || uploaderBusy}>
            {busy === 'complete' && <Spinner />}
            {t('markCompleteButton')}
          </Button>
        </div>
      )}

      {canCancel && (
        <Button variant="destructive" onClick={cancel} disabled={busy != null}>
          {busy === 'cancel' && <Spinner />}
          {t('cancelButton')}
        </Button>
      )}

      {(job.status === 'COMPLETED' || job.status === 'RATED' || job.status === 'CANCELLED') && (
        <p className="text-sm text-muted-foreground">{t('noFurtherActions')}</p>
      )}
    </div>
  );
}
