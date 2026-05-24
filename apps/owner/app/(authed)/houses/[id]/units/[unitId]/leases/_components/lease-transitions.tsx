'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { Lease, LeaseStatus } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../lib/api';

interface Props {
  houseId: string;
  unitId: string;
  lease: Lease;
}

const ALLOWED: Record<LeaseStatus, LeaseStatus[]> = {
  DRAFT: ['ACTIVE', 'TERMINATED'],
  ACTIVE: ['ENDED', 'TERMINATED'],
  ENDED: [],
  TERMINATED: [],
};

export function LeaseTransitions({ houseId, unitId, lease }: Props) {
  const t = useTranslations('owner.leases.transitions');
  const router = useRouter();
  const [busy, setBusy] = useState<LeaseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = ALLOWED[lease.status];
  if (allowed.length === 0) return null;

  async function transition(to: LeaseStatus) {
    let reason: string | undefined;
    if (to === 'TERMINATED') {
      reason = window.prompt(t('terminatePrompt')) ?? undefined;
      if (!reason?.trim()) return;
    } else {
      const confirmMsg = to === 'ACTIVE' ? t('activateConfirm') : t('endConfirm');
      if (!window.confirm(confirmMsg)) return;
    }

    setBusy(to);
    setError(null);
    try {
      await api.post(`/v1/houses/${houseId}/units/${unitId}/leases/${lease.id}/transitions`, {
        to,
        ...(reason && { terminationReason: reason }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : t('failed'));
    } finally {
      setBusy(null);
    }
  }

  function labelFor(to: LeaseStatus): string {
    switch (to) {
      case 'ACTIVE':
        return t('activate');
      case 'ENDED':
        return t('endLease');
      case 'TERMINATED':
        return t('terminate');
      default:
        return to;
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
            variant={to === 'TERMINATED' ? 'destructive' : 'default'}
            disabled={busy != null}
            onClick={() => transition(to)}
          >
            {busy === to && <Spinner />}
            {labelFor(to)}
          </Button>
        ))}
      </div>
    </div>
  );
}
