'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { ListNotificationPreferencesResponse, NotificationPreference } from '@repo/shared';
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { api } from '../../../../lib/api';

/** The tenant-side subset of notification topics. */
const TENANT_TOPICS: readonly { topic: NotificationPreference['topic']; key: string }[] = [
  { topic: 'bill.issued', key: 'bill.issued' },
  { topic: 'bill.paid', key: 'bill.paid' },
  { topic: 'bill.refunded', key: 'bill.refunded' },
  { topic: 'ticket.resolved', key: 'ticket.resolved' },
];

/**
 * Per-topic mute toggles. Initial state hydrates from the server on
 * mount; each checkbox change PUTs immediately (no save button).
 *
 * The component never throws — failed PUTs roll back the local
 * checkbox state + surface an inline alert.
 */
export function PreferencesCard() {
  const t = useTranslations('tenant.notifications.prefs');
  const tTopic = useTranslations('tenant.notifications.prefs.topics');
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
      setError(t('updateFailed', { topic }));
    } finally {
      setBusy(null);
    }
  }

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
        <ul className="divide-y">
          {TENANT_TOPICS.map((row) => {
            const isMuted = muted[row.topic] ?? false;
            return (
              <li key={row.topic} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{tTopic(`${row.key}.label`)}</p>
                  <p className="text-xs text-muted-foreground">{tTopic(`${row.key}.help`)}</p>
                </div>
                <label className="flex flex-none items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!isMuted}
                    disabled={busy === row.topic}
                    onChange={(e) => void toggle(row.topic, !e.currentTarget.checked)}
                    className="h-4 w-4"
                  />
                  <span className="text-muted-foreground">{isMuted ? t('muted') : t('on')}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
