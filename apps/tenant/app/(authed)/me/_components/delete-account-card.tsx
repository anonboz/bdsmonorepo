'use client';

import { useEffect, useState } from 'react';

import type { AccountErasureRequestResponse } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '@repo/ui';

import { ApiError, api } from '../../../../lib/api';

/**
 * Phase 10.6 — self-serve account-deletion control.
 *
 * Three visual states:
 *   - **no pending row** → "Delete my account" button + double-confirm modal.
 *   - **pending** → banner showing the scheduled date + a "Cancel deletion" button.
 *   - **completed** → terminal banner; shouldn't normally render because
 *     the user wouldn't be authenticated at this point.
 */
export function DeleteAccountCard() {
  const [state, setState] = useState<AccountErasureRequestResponse | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<AccountErasureRequestResponse | null>('/v1/me/erase-request');
        setState(res);
      } catch {
        setState(null);
      }
    })();
  }, []);

  async function schedule() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<AccountErasureRequestResponse>('/v1/me/erase-request');
      setState(res);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Could not schedule deletion.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await api.delete('/v1/me/erase-request');
      setState(null);
    } catch {
      setError('Could not cancel the deletion. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Delete account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  const pending = state && state.cancelledAt === null && state.completedAt === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Delete account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {pending ? (
          <>
            <Alert>
              <AlertDescription>
                Your account is scheduled for deletion on{' '}
                <strong>{new Date(state.executeAfter).toLocaleString()}</strong>. You can cancel
                anytime before then.
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
              {busy && <Spinner />}
              Cancel deletion
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              You can delete your account at any time. We&apos;ll keep a 7-day grace window so you
              can undo from the confirmation email if you change your mind. After that, your data is
              anonymized and uploaded photos are purged.
            </p>
            {confirming ? (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium">This will schedule your account for deletion.</p>
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => void schedule()} disabled={busy}>
                    {busy && <Spinner />}
                    Yes, schedule deletion
                  </Button>
                  <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                    Keep my account
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Delete my account
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
