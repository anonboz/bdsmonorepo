'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../lib/api';

export interface DeleteUnitButtonProps {
  houseId: string;
  unitId: string;
  unitLabel: string;
}

export function DeleteUnitButton({ houseId, unitId, unitLabel }: DeleteUnitButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm(`Delete unit "${unitLabel}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/v1/houses/${houseId}/units/${unitId}`);
      router.push(`/houses/${houseId}/units`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Delete failed.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="destructive" disabled={busy} onClick={handleDelete}>
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
