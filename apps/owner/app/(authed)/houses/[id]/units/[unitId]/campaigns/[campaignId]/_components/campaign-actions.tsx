'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Campaign } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

type OwnerTransition = 'PENDING' | 'DRAFT' | 'CLOSED';

export function CampaignActions({
  houseId,
  unitId,
  campaign,
}: {
  houseId: string;
  unitId: string;
  campaign: Campaign;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<OwnerTransition | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(to: OwnerTransition, confirmMsg?: string) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(to);
    setError(null);
    try {
      await api.post<Campaign>(
        `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}/transitions`,
        { to },
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Action failed.');
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
        {campaign.status === 'DRAFT' && (
          <Button
            disabled={busy != null}
            onClick={() => handle('PENDING', 'Submit this campaign for admin review?')}
          >
            {busy === 'PENDING' && <Spinner />}
            Submit for review
          </Button>
        )}
        {campaign.status === 'PENDING' && (
          <Button variant="outline" disabled={busy != null} onClick={() => handle('DRAFT')}>
            {busy === 'DRAFT' && <Spinner />}
            Withdraw
          </Button>
        )}
        {campaign.status === 'LIVE' && (
          <Button
            variant="destructive"
            disabled={busy != null}
            onClick={() =>
              handle('CLOSED', 'Close this campaign? It will stop accepting applications.')
            }
          >
            {busy === 'CLOSED' && <Spinner />}
            Close
          </Button>
        )}
        {campaign.status === 'REJECTED' && (
          <Button
            disabled={busy != null}
            onClick={() => handle('PENDING', 'Re-submit this campaign for admin review?')}
          >
            {busy === 'PENDING' && <Spinner />}
            Re-submit for review
          </Button>
        )}
        {(campaign.status === 'CLOSED' || campaign.status === 'EXPIRED') && (
          <p className="text-sm text-muted-foreground">
            No further owner actions on this campaign.
          </p>
        )}
      </div>
    </div>
  );
}
