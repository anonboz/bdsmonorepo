'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { UnreadCountResponse } from '@repo/shared';
import { NotificationBell } from '@repo/ui';

import { api } from '../../../lib/api';

const POLL_MS = 60_000;

/**
 * Bell-and-badge link that polls `/v1/notifications/unread-count` so
 * the count stays roughly current without SSE / websockets. The poll
 * interval (60s) keeps the request volume sane on slow tabs; the
 * mailer + 8.2 fanout already covers urgent surfaces (email).
 */
export function NotificationBellLink({ initialUnread = 0 }: { initialUnread?: number }) {
  const [unread, setUnread] = useState(initialUnread);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await api.get<UnreadCountResponse>('/v1/notifications/unread-count');
        if (!cancelled) setUnread(res.unread);
      } catch {
        // Silent: a transient 401 / 5xx shouldn't blow up the badge.
        // The next poll will retry. If the user has lost their
        // session, the (authed) layout's next nav check sends them
        // to /login.
      }
    }
    void refresh();
    const handle = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      className="text-foreground hover:text-foreground/80"
    >
      <NotificationBell unreadCount={unread} />
    </Link>
  );
}
