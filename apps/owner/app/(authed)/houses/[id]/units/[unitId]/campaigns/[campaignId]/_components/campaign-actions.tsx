'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('owner.campaigns.actions');
  const tChrome = useTranslations('owner.chrome');
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
      setError(err instanceof ApiError ? err.problem.title : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{tChrome('actionFailedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {campaign.status === 'DRAFT' && (
          <Button disabled={busy != null} onClick={() => handle('PENDING', t('submitConfirm'))}>
            {busy === 'PENDING' && <Spinner />}
            {t('submit')}
          </Button>
        )}
        {campaign.status === 'PENDING' && (
          <Button variant="outline" disabled={busy != null} onClick={() => handle('DRAFT')}>
            {busy === 'DRAFT' && <Spinner />}
            {t('withdraw')}
          </Button>
        )}
        {campaign.status === 'LIVE' && (
          <Button
            variant="destructive"
            disabled={busy != null}
            onClick={() => handle('CLOSED', t('closeConfirm'))}
          >
            {busy === 'CLOSED' && <Spinner />}
            {t('close')}
          </Button>
        )}
        {campaign.status === 'REJECTED' && (
          <Button disabled={busy != null} onClick={() => handle('PENDING', t('resubmitConfirm'))}>
            {busy === 'PENDING' && <Spinner />}
            {t('resubmit')}
          </Button>
        )}
        {(campaign.status === 'CLOSED' || campaign.status === 'EXPIRED') && (
          <p className="text-sm text-muted-foreground">{t('noFurther')}</p>
        )}
      </div>
    </div>
  );
}
