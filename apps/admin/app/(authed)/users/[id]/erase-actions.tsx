'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { AdminUser } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

/**
 * Irreversible GDPR-erasure action. Asks for typed confirmation
 * ("ERASE") since the operation can't be undone — anonymises PII +
 * purges S3 objects + fires a PostHog person-delete. Audit row is
 * written by the server regardless.
 */
export function EraseActions({
  userId,
  isAlreadyErased,
}: {
  userId: string;
  isAlreadyErased: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle() {
    const answer = window.prompt(
      'This anonymises PII, purges photos from S3, and deletes the PostHog person. Type ERASE to confirm.',
    );
    if (answer?.trim() !== 'ERASE') return;

    setBusy(true);
    setError(null);
    try {
      await api.post<AdminUser>(`/v1/admin/users/${userId}/erase`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Erase failed');
    } finally {
      setBusy(false);
    }
  }

  if (isAlreadyErased) {
    return (
      <p className="text-sm text-muted-foreground">
        This user is already erased. Their PII has been anonymised and their owned media has been
        purged.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Action failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button variant="destructive" disabled={busy} onClick={handle}>
        {busy && <Spinner />}
        Erase user (GDPR)
      </Button>
      <p className="text-xs text-muted-foreground">
        Irreversible. Owner-side bills and audit history remain (legal retention).
      </p>
    </div>
  );
}
