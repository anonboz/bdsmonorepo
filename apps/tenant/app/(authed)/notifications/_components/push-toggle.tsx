'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { ListPushSubscriptionsResponse, PushSubscription } from '@repo/shared';
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

import { api } from '../../../../lib/api';
import {
  PushSubscriptionError,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../../../../lib/push';

/**
 * Phase 10.5 — single-click opt-in for web push. Shows the user's
 * existing subscriptions (one per device + browser) and a button
 * that either subscribes the current browser or unsubscribes it.
 *
 * Hidden entirely when the browser doesn't support push or the
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY` env var is empty in this build —
 * no value showing a disabled toggle the user can't act on.
 */
export function PushToggle() {
  const t = useTranslations('tenant.notifications.push');
  const tErr = useTranslations('tenant.notifications.push.errors');
  const [supported, setSupported] = useState(false);
  const [subs, setSubs] = useState<PushSubscription[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupported(isPushSupported());
  }, []);

  useEffect(() => {
    if (!supported) return;
    void (async () => {
      try {
        const res = await api.get<ListPushSubscriptionsResponse>(
          '/v1/notifications/push-subscriptions',
        );
        setSubs(res.subscriptions);
      } catch {
        setSubs([]);
      }
    })();
  }, [supported]);

  if (!supported) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const created = await subscribeToPush();
      setSubs((cur) => [created, ...(cur ?? []).filter((s) => s.id !== created.id)]);
    } catch (err) {
      if (err instanceof PushSubscriptionError) {
        setError(messageFor(err, tErr));
      } else {
        setError(t('enableFailed'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable(id: string) {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush(id);
      setSubs((cur) => (cur ?? []).filter((s) => s.id !== id));
    } catch {
      setError(t('disableFailed'));
    } finally {
      setBusy(false);
    }
  }

  const hasAny = (subs?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {subs == null ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : (
          <>
            {hasAny && (
              <ul className="space-y-2">
                {subs.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.userAgent ?? t('unknownDevice')}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t('addedAt', { date: new Date(s.createdAt).toLocaleString() })}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void disable(s.id)}
                    >
                      {t('remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button type="button" disabled={busy} onClick={() => void enable()}>
                {busy && <Spinner />}
                {hasAny ? t('addThisDevice') : t('enable')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function messageFor(err: PushSubscriptionError, tErr: (key: string) => string): string {
  switch (err.code) {
    case 'permission-denied':
      return tErr('permissionDenied');
    case 'vapid-missing':
      return tErr('vapidMissing');
    case 'unsupported':
      return tErr('unsupported');
    case 'no-service-worker':
      return tErr('noServiceWorker');
    default:
      return err.message;
  }
}
