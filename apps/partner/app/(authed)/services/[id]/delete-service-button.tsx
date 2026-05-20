'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

export function DeleteServiceButton({
  serviceId,
  serviceName,
}: {
  serviceId: string;
  serviceName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (!window.confirm(`Delete service "${serviceName}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/v1/me/services/${serviceId}`);
      router.push('/services');
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
