'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [busy, setBusy] = useState<LeaseStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allowed = ALLOWED[lease.status];
  if (allowed.length === 0) return null;

  async function transition(to: LeaseStatus) {
    let reason: string | undefined;
    if (to === 'TERMINATED') {
      reason = window.prompt('Why are you terminating this lease?') ?? undefined;
      if (!reason?.trim()) return;
    } else {
      const verb = to === 'ACTIVE' ? 'activate' : 'end';
      if (!window.confirm(`Are you sure you want to ${verb} this lease?`)) return;
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

function labelFor(to: LeaseStatus): string {
  switch (to) {
    case 'ACTIVE':
      return 'Activate';
    case 'ENDED':
      return 'End lease';
    case 'TERMINATED':
      return 'Terminate';
    default:
      return to;
  }
}
