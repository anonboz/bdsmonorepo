'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Application } from '@repo/shared';
import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

export function WithdrawButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (!window.confirm('Withdraw this application? You can re-apply later.')) return;
    setBusy(true);
    setError(null);
    try {
      await api.post<Application>(`/v1/me/applications/${applicationId}/withdraw`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Withdraw failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        Withdraw
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
