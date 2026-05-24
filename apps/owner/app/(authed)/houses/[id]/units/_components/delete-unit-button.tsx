'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../lib/api';

export interface DeleteUnitButtonProps {
  houseId: string;
  unitId: string;
  unitLabel: string;
}

export function DeleteUnitButton({ houseId, unitId, unitLabel }: DeleteUnitButtonProps) {
  const t = useTranslations('owner');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(t('units.delete.confirm', { label: unitLabel }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/v1/houses/${houseId}/units/${unitId}`);
      router.push(`/houses/${houseId}/units`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('chrome.deleteFailed'));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" disabled={busy} onClick={handleDelete}>
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
