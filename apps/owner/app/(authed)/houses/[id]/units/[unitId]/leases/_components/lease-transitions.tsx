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

/**
 * Phase 12.3 — the manual transition API no longer takes a lease
 * directly to `ACTIVE`. Owners now move
 * `DRAFT → AWAITING_SIGNATURES`; both parties draw signatures; the
 * signatures service auto-flips the lease to `ACTIVE` when both
 * Signature rows land. `AWAITING_SIGNATURES → DRAFT` is allowed for
 * re-editing (cascades any captured signatures).
 */
type ManualTarget = Extract<LeaseStatus, 'AWAITING_SIGNATURES' | 'DRAFT' | 'ENDED' | 'TERMINATED'>;

const ALLOWED: Record<LeaseStatus, ManualTarget[]> = {
  DRAFT: ['AWAITING_SIGNATURES', 'TERMINATED'],
  AWAITING_SIGNATURES: ['DRAFT', 'TERMINATED'],
  ACTIVE: ['ENDED', 'TERMINATED'],
  ENDED: [],
  TERMINATED: [],
};

export function LeaseTransitions({ houseId, unitId, lease }: Props) {
  const t = useTranslations('owner.leases.transitions');
  const router = useRouter();
  const [busy, setBusy] = useState<ManualTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = ALLOWED[lease.status];
  if (allowed.length === 0) return null;

  async function transition(to: ManualTarget) {
    let reason: string | undefined;
    if (to === 'TERMINATED') {
      reason = window.prompt(t('terminatePrompt')) ?? undefined;
      if (!reason?.trim()) return;
    } else if (to === 'DRAFT') {
      if (!window.confirm(t('revertConfirm'))) return;
    } else {
      const confirmMsg =
        to === 'AWAITING_SIGNATURES' ? t('sendForSignaturesConfirm') : t('endConfirm');
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

  function labelFor(to: ManualTarget): string {
    switch (to) {
      case 'AWAITING_SIGNATURES':
        return t('sendForSignatures');
      case 'DRAFT':
        return t('revertToDraft');
      case 'ENDED':
        return t('endLease');
      case 'TERMINATED':
        return t('terminate');
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
