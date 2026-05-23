'use client';

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
        setError(messageFor(err));
      } else {
        setError('Could not enable push notifications. Try again.');
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
      setError('Could not disable. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const hasAny = (subs?.length ?? 0) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Push notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Get system notifications on this device when a bill drops or a ticket updates. You can
          mute by topic in the preferences panel above.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {subs == null ? (
          <p className="text-sm text-muted-foreground">Loading subscriptions…</p>
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
                      <p className="truncate font-medium">{s.userAgent ?? 'Unknown device'}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Added {new Date(s.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void disable(s.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <Button type="button" disabled={busy} onClick={() => void enable()}>
                {busy && <Spinner />}
                {hasAny ? 'Add this device' : 'Enable push on this device'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function messageFor(err: PushSubscriptionError): string {
  switch (err.code) {
    case 'permission-denied':
      return 'Browser blocked notification permission. Re-enable it in site settings, then try again.';
    case 'vapid-missing':
      return 'Push isn’t configured on the server.';
    case 'unsupported':
      return 'This browser doesn’t support web push.';
    case 'no-service-worker':
      return 'The app’s service worker hasn’t loaded yet — reload the page and try again.';
    default:
      return err.message;
  }
}
