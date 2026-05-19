'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminUser } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

export function SuspendActions({ userId, isSuspended }: { userId: string; isSuspended: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(verb: 'suspend' | 'unsuspend') {
    const reason = window.prompt(`Reason for ${verb}?`);
    if (!reason?.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await api.post<AdminUser>(`/v1/admin/users/${userId}/${verb}`, { reason: reason.trim() });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : `${verb} failed`);
    } finally {
      setBusy(false);
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
      {isSuspended ? (
        <Button disabled={busy} onClick={() => handle('unsuspend')}>
          {busy && <Spinner />}
          Unsuspend
        </Button>
      ) : (
        <Button variant="destructive" disabled={busy} onClick={() => handle('suspend')}>
          {busy && <Spinner />}
          Suspend
        </Button>
      )}
    </div>
  );
}
