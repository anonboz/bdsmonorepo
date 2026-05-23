'use client';

import { useEffect, useState } from 'react';

import type { ListNotificationPreferencesResponse, NotificationPreference } from '@repo/shared';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { api } from '../../../../lib/api';

/**
 * The tenant-side subset of notification topics. The API stores
 * preferences against every canonical topic regardless of role; this
 * card just filters down to the ones a tenant actually receives so
 * the toggle list stays readable.
 */
const TENANT_TOPICS: readonly {
  topic: NotificationPreference['topic'];
  label: string;
  help: string;
}[] = [
  {
    topic: 'bill.issued',
    label: 'New bill issued',
    help: 'Email when your landlord generates a new bill.',
  },
  {
    topic: 'bill.paid',
    label: 'Payment confirmed',
    help: 'Email when a payment clears (manual, Stripe, or VNPay).',
  },
  {
    topic: 'bill.refunded',
    label: 'Refund issued',
    help: 'Email when your landlord refunds a payment.',
  },
  {
    topic: 'ticket.resolved',
    label: 'Ticket resolved',
    help: 'Email when your landlord marks a ticket resolved.',
  },
];

/**
 * Per-topic mute toggles. Initial state hydrates from the server on
 * mount; each checkbox change PUTs immediately (no save button).
 *
 * The component never throws — failed PUTs roll back the local
 * checkbox state + surface an inline alert.
 */
export function PreferencesCard() {
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<ListNotificationPreferencesResponse>(
          '/v1/notifications/preferences',
        );
        setMuted(Object.fromEntries(res.preferences.map((p) => [p.topic, p.muted])));
      } catch {
        // Soft-fail: the inbox is more important than the prefs card.
      }
    })();
  }, []);

  async function toggle(topic: string, next: boolean) {
    setBusy(topic);
    setError(null);
    // Optimistic update so the click feels instant.
    const previous = muted[topic] ?? false;
    setMuted((cur) => ({ ...cur, [topic]: next }));
    try {
      await api.put(`/v1/notifications/preferences/${topic}`, { muted: next });
    } catch {
      setMuted((cur) => ({ ...cur, [topic]: previous }));
      setError(`Could not update "${topic}". Try again.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notification preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <ul className="divide-y">
          {TENANT_TOPICS.map((t) => {
            const isMuted = muted[t.topic] ?? false;
            return (
              <li key={t.topic} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-xs text-muted-foreground">{t.help}</p>
                </div>
                <label className="flex flex-none items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!isMuted}
                    disabled={busy === t.topic}
                    onChange={(e) => void toggle(t.topic, !e.currentTarget.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-muted-foreground">{isMuted ? 'Muted' : 'On'}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
