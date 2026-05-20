'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { Application } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../lib/api';

type Action = 'accept' | 'reject';

/**
 * Accept mints a DRAFT lease server-side and closes the campaign. On
 * success we route the owner to the newly-created lease so they can
 * finalize the terms before activating.
 */
export function ApplicationActions({
  houseId,
  unitId,
  campaignId,
  applicationId,
}: {
  houseId: string;
  unitId: string;
  campaignId: string;
  applicationId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    if (
      !window.confirm(
        'Accept this application? This will create a DRAFT lease and close the listing.',
      )
    ) {
      return;
    }
    setBusy('accept');
    setError(null);
    try {
      const a = await api.post<Application>(
        `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}/applications/${applicationId}/accept`,
        {},
      );
      if (a.createdLeaseId) {
        router.push(`/houses/${houseId}/units/${unitId}/leases/${a.createdLeaseId}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Accept failed');
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const reason = window.prompt('Reason for rejection? (visible to the applicant)');
    if (!reason?.trim()) return;
    setBusy('reject');
    setError(null);
    try {
      await api.post<Application>(
        `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}/applications/${applicationId}/reject`,
        { reason: reason.trim() },
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Reject failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy != null} onClick={accept}>
          {busy === 'accept' && <Spinner />}
          Accept
        </Button>
        <Button variant="destructive" disabled={busy != null} onClick={reject}>
          {busy === 'reject' && <Spinner />}
          Reject
        </Button>
      </div>
    </div>
  );
}
