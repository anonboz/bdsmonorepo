'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminUser, KycStatus } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

type Decision = 'APPROVED' | 'REJECTED' | 'PENDING' | 'NONE';

const ALL_DECISIONS: Decision[] = ['APPROVED', 'REJECTED', 'PENDING', 'NONE'];

export function KycActions({ userId, current }: { userId: string; current: KycStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(decision: Decision) {
    if (decision === current) return;
    let body: Record<string, unknown> = { decision };
    if (decision === 'REJECTED') {
      const reason = window.prompt('Reason for rejection? (visible to the user)');
      if (!reason?.trim()) return;
      body = { decision, reason: reason.trim() };
    } else {
      const verb =
        decision === 'APPROVED' ? 'approve' : decision === 'PENDING' ? 'requeue' : 'reset to NONE';
      if (!window.confirm(`${verb}? Current is ${current}.`)) return;
    }

    setBusy(decision);
    setError(null);
    try {
      await api.post<AdminUser>(`/v1/admin/users/${userId}/kyc-decision`, body);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'KYC update failed');
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
        {ALL_DECISIONS.map((d) => (
          <Button
            key={d}
            variant={d === 'REJECTED' ? 'destructive' : d === 'APPROVED' ? 'default' : 'outline'}
            disabled={busy != null || d === current}
            onClick={() => handle(d)}
          >
            {busy === d && <Spinner />}
            {labelFor(d)}
          </Button>
        ))}
      </div>
    </div>
  );
}

function labelFor(d: Decision): string {
  switch (d) {
    case 'APPROVED':
      return 'Approve';
    case 'REJECTED':
      return 'Reject';
    case 'PENDING':
      return 'Re-queue';
    case 'NONE':
      return 'Reset';
  }
}
