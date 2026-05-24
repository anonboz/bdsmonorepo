'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
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

export function TicketTransitions({
  ticketId,
  currentStatus,
}: {
  ticketId: string;
  currentStatus: TicketStatus;
}) {
  const t = useTranslations('owner.tickets.transitions');
  const tLabel = useTranslations('owner.tickets.transitions.labels');
  const router = useRouter();
  const [busy, setBusy] = useState<TicketStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = OWNER_TRANSITIONS[currentStatus];
  if (allowed.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('noFurther')}</p>;
  }

  async function transition(to: TicketStatus) {
    if (to === 'CLOSED' && !window.confirm(t('closeConfirm'))) return;
    setBusy(to);
    setError(null);
    try {
      await api.post(`/v1/me/owner-tickets/${ticketId}/transitions`, { to });
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
          <AlertTitle>{t('failedTitle')}</AlertTitle>
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
            {tLabel(to)}
          </Button>
        ))}
      </div>
    </div>
  );
}
