'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ServiceJob } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

type Action = 'accept' | 'cancel';

export function OwnerJobActions({ job }: { job: ServiceJob }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(): Promise<void> {
    if (!window.confirm('Accept this quote? The partner can then start work.')) return;
    setBusy('accept');
    setError(null);
    try {
      await api.post<ServiceJob>(`/v1/me/service-jobs/${job.id}/accept`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Accept failed');
    } finally {
      setBusy(null);
    }
  }

  async function cancel(): Promise<void> {
    const reason = window.prompt('Reason for cancelling? (visible to the partner)');
    if (!reason?.trim()) return;
    setBusy('cancel');
    setError(null);
    try {
      await api.post<ServiceJob>(`/v1/me/service-jobs/${job.id}/cancel`, {
        reason: reason.trim(),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Cancel failed');
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
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {canAccept && (
          <Button disabled={busy != null} onClick={accept}>
            {busy === 'accept' && <Spinner />}
            Accept quote
          </Button>
        )}
        {canCancel && (
          <Button variant="destructive" disabled={busy != null} onClick={cancel}>
            {busy === 'cancel' && <Spinner />}
            Cancel
          </Button>
        )}
        {!canAccept && !canCancel && (
          <p className="text-sm text-muted-foreground">No further owner actions.</p>
        )}
      </div>
    </div>
  );
}
