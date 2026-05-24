'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import type { UnreadCountResponse } from '@repo/shared';
import { NotificationBell } from '@repo/ui';

import { api } from '../../../lib/api';

const POLL_MS = 60_000;

export function NotificationBellLink({ initialUnread = 0 }: { initialUnread?: number }) {
  const t = useTranslations('partner.chrome');
  const [unread, setUnread] = useState(initialUnread);
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await api.get<UnreadCountResponse>('/v1/notifications/unread-count');
        if (!cancelled) setUnread(res.unread);
      } catch {
        /* transient errors stay silent — next tick retries */
      }
    }
    void refresh();
    const handle = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const ariaLabel =
    unread > 0 ? t('notificationsAriaUnread', { count: unread }) : t('notificationsAria');

  return (
    <Link
      href="/notifications"
      aria-label={ariaLabel}
      className="text-foreground hover:text-foreground/80"
    >
      <NotificationBell unreadCount={unread} />
    </Link>
  );
}
