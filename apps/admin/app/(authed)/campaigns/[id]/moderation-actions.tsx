'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Campaign, CampaignStatus } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

type Action = 'approve' | 'reject';

export function ModerationActions({
  campaignId,
  status,
}: {
  campaignId: string;
  status: CampaignStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'PENDING') {
    return (
      <p className="text-sm text-muted-foreground">
        Only PENDING campaigns can be approved or rejected. Current state:{' '}
        <strong>{status.toLowerCase()}</strong>.
      </p>
    );
  }

  async function handle(action: Action) {
    setError(null);
    if (action === 'reject') {
      const reason = window.prompt('Reason for rejection? (visible to the owner)');
      if (!reason?.trim()) return;
      setBusy('reject');
      try {
        await api.post<Campaign>(`/v1/admin/campaigns/${campaignId}/reject`, {
          reason: reason.trim(),
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.problem.title : 'Reject failed');
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!window.confirm('Approve and publish this campaign?')) return;
    setBusy('approve');
    try {
      await api.post<Campaign>(`/v1/admin/campaigns/${campaignId}/approve`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy != null} onClick={() => handle('approve')}>
          {busy === 'approve' && <Spinner />}
          Approve
        </Button>
        <Button variant="destructive" disabled={busy != null} onClick={() => handle('reject')}>
          {busy === 'reject' && <Spinner />}
          Reject
        </Button>
      </div>
    </div>
  );
}
