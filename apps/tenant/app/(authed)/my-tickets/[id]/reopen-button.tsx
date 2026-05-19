'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

export function ReopenButton({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    if (
      !window.confirm(
        "Reopen this ticket? The owner will be notified that it isn't actually resolved.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/me/tickets/${ticketId}/transitions`, { to: 'REOPENED' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Reopen failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        Reopen
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
