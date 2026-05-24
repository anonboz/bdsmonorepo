'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { ServiceJob } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

type Action = 'accept' | 'cancel';

export function OwnerJobActions({ job }: { job: ServiceJob }) {
  const t = useTranslations('owner.serviceJobs.actions');
  const tChrome = useTranslations('owner.chrome');
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    if (!window.confirm(t('acceptConfirm'))) return;
    setBusy('accept');
    setError(null);
    try {
      await api.post<ServiceJob>(`/v1/me/service-jobs/${job.id}/accept`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('acceptFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    const reason = window.prompt(t('cancelPrompt'));
    if (!reason?.trim()) return;
    setBusy('cancel');
    setError(null);
    try {
      await api.post<ServiceJob>(`/v1/me/service-jobs/${job.id}/cancel`, {
        reason: reason.trim(),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('cancelFailed'));
    } finally {
      setBusy(null);
    }
  }

  const canAccept = job.status === 'QUOTED';
  const canCancel =
    job.status === 'REQUESTED' ||
    job.status === 'QUOTED' ||
    job.status === 'ACCEPTED' ||
    job.status === 'IN_PROGRESS';

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{tChrome('actionFailedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button disabled={busy != null} onClick={accept}>
            {busy === 'accept' && <Spinner />}
            {t('accept')}
          </Button>
        )}
        {canCancel && (
          <Button variant="destructive" disabled={busy != null} onClick={cancel}>
            {busy === 'cancel' && <Spinner />}
            {t('cancel')}
          </Button>
        )}
        {!canAccept && !canCancel && (
          <p className="text-sm text-muted-foreground">{t('noFurther')}</p>
        )}
      </div>
    </div>
  );
}
