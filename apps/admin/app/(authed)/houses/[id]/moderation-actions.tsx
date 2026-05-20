'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { House, HouseModerationStatus } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

type Action = 'flag' | 'clear' | 'reject';

export function ModerationActions({
  houseId,
  current,
}: {
  houseId: string;
  current: HouseModerationStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(action: Action) {
    if (!isAvailable(action, current)) return;
    const reason = window.prompt(promptFor(action));
    if (!reason?.trim()) return;
    if (action === 'reject' && !window.confirm('Reject this listing? It will be unpublished.')) {
      return;
    }
    setBusy(action);
    setError(null);
    try {
      await api.post<House>(`/v1/admin/houses/${houseId}/${action}`, { reason: reason.trim() });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : `${action} failed`);
    } finally {
      setBusy(null);
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
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy != null || !isAvailable('flag', current)}
          onClick={() => handle('flag')}
        >
          {busy === 'flag' && <Spinner />}
          Flag
        </Button>
        <Button
          disabled={busy != null || !isAvailable('clear', current)}
          onClick={() => handle('clear')}
        >
          {busy === 'clear' && <Spinner />}
          Clear
        </Button>
        <Button
          variant="destructive"
          disabled={busy != null || !isAvailable('reject', current)}
          onClick={() => handle('reject')}
        >
          {busy === 'reject' && <Spinner />}
          Reject
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Current state: <strong>{current.toLowerCase()}</strong>. Buttons disable when they would be
        a no-op.
      </p>
    </div>
  );
}

function isAvailable(action: Action, current: HouseModerationStatus): boolean {
  if (action === 'flag') return current !== 'FLAGGED';
  if (action === 'clear') return current !== 'OK';
  return current !== 'REJECTED';
}

function promptFor(action: Action): string {
  switch (action) {
    case 'flag':
      return 'Reason for flagging? (will be visible to the owner)';
    case 'clear':
      return 'Reason for clearing? (audit trail only)';
    case 'reject':
      return 'Reason for rejection? (will be visible to the owner)';
  }
}
