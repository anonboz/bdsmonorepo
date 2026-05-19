'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { TicketStatus } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

/**
 * Mirror of the server-side ALLOWED_TRANSITIONS for owner-visible
 * options. REOPENED is excluded — that's tenant-only.
 */
const OWNER_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED', 'CLOSED'],
  ACKNOWLEDGED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
  REOPENED: ['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
};

const LABEL: Record<TicketStatus, string> = {
  ACKNOWLEDGED: 'Acknowledge',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolve',
  CLOSED: 'Close',
  OPEN: 'Open',
  REOPENED: 'Reopen',
};

export function TicketTransitions({
  ticketId,
  currentStatus,
}: {
  ticketId: string;
  currentStatus: TicketStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<TicketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = OWNER_TRANSITIONS[currentStatus];
  if (allowed.length === 0) {
    return <p className="text-sm text-muted-foreground">No further actions.</p>;
  }

  async function transition(to: TicketStatus) {
    if (to === 'CLOSED' && !window.confirm('Close this ticket?')) return;
    setBusy(to);
    setError(null);
    try {
      await api.post(`/v1/me/owner-tickets/${ticketId}/transitions`, { to });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Transition failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Transition failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {allowed.map((to) => (
          <Button
            key={to}
            variant={to === 'CLOSED' ? 'outline' : 'default'}
            disabled={busy != null}
            onClick={() => transition(to)}
          >
            {busy === to && <Spinner />}
            {LABEL[to]}
          </Button>
        ))}
      </div>
    </div>
  );
}
