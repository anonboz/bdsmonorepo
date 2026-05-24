'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Application } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

type Action = 'accept' | 'reject';

export function ApplicationActions({
  houseId,
  unitId,
  campaignId,
  applicationId,
}: {
  houseId: string;
  unitId: string;
  campaignId: string;
  applicationId: string;
}) {
  const t = useTranslations('owner.campaigns.applicationActions');
  const tChrome = useTranslations('owner.chrome');
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (!window.confirm(t('acceptConfirm'))) {
      return;
    }
    setBusy('accept');
    setError(null);
    try {
      const a = await api.post<Application>(
        `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}/applications/${applicationId}/accept`,
        {},
      );
      if (a.createdLeaseId) {
        router.push(`/houses/${houseId}/units/${unitId}/leases/${a.createdLeaseId}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('accepted'));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const reason = window.prompt(t('rejectPrompt'));
    if (!reason?.trim()) return;
    setBusy('reject');
    setError(null);
    try {
      await api.post<Application>(
        `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}/applications/${applicationId}/reject`,
        { reason: reason.trim() },
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('rejectFailed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{tChrome('actionFailedTitle')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy != null} onClick={accept}>
          {busy === 'accept' && <Spinner />}
          {t('accept')}
        </Button>
        <Button variant="destructive" disabled={busy != null} onClick={reject}>
          {busy === 'reject' && <Spinner />}
          {t('reject')}
        </Button>
      </div>
    </div>
  );
}
