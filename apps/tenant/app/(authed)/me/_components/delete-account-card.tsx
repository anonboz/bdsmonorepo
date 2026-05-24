'use client';

import { useTranslations } from 'next-intl';
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
  const t = useTranslations('tenant.account.delete');
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
      setError(err instanceof ApiError ? err.problem.title : t('couldNotSchedule'));
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
      setError(t('couldNotCancel'));
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        </CardContent>
      </Card>
    );
  }

  const pending = state?.cancelledAt === null && state.completedAt === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
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
                {t.rich('pendingBody', {
                  date: new Date(state.executeAfter).toLocaleString(),
                  strong: (chunks) => <strong>{chunks}</strong>,
                })}
              </AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => void cancel()} disabled={busy}>
              {busy && <Spinner />}
              {t('cancelButton')}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('warning')}</p>
            {confirming ? (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium">{t('confirmTitle')}</p>
                <div className="flex gap-2">
                  <Button variant="destructive" onClick={() => void schedule()} disabled={busy}>
                    {busy && <Spinner />}
                    {t('confirmYes')}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                    {t('confirmNo')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                {t('deleteButton')}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
