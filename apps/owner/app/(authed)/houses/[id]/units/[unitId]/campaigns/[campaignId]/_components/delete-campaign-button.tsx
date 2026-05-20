'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

export function DeleteCampaignButton({
  houseId,
  unitId,
  campaignId,
  campaignTitle,
}: {
  houseId: string;
  unitId: string;
  campaignId: string;
  campaignTitle: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (!window.confirm(`Delete campaign "${campaignTitle}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}`);
      router.push(`/houses/${houseId}/units/${unitId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Delete failed.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        Delete
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
