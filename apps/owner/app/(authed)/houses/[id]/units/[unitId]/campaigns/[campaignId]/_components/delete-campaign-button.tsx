'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('owner');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (!window.confirm(t('campaigns.delete.confirm', { title: campaignTitle }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}`);
      router.push(`/houses/${houseId}/units/${unitId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('chrome.deleteFailed'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        {t('chrome.delete')}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
