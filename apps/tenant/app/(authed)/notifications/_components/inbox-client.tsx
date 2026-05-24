'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';

import type { Notification, Page } from '@repo/shared';
import { Button, NotificationInboxList, NotificationInboxRow } from '@repo/ui';

import { api } from '../../../../lib/api';

/**
 * Client-side inbox: optimistic mark-read + Mark-all-read mutation +
 * topic-derived deep-link navigation. The Server Component above
 * hands over the first page; the client owns the read-state churn so
 * a row click doesn't force a server round-trip before the badge
 * dims.
 */
export function InboxClient({ initial }: { initial: Page<Notification> }) {
  const t = useTranslations('tenant.notifications');
  const [items, setItems] = useState(initial.items);
  const [busy, startBusy] = useTransition();
  const router = useRouter();

  function handleRowClick(item: Notification) {
    const href = resolveHref(item);
    // Optimistically flip readAt so the badge / row styling updates
    // before the API call returns.
    if (!item.readAt) {
      const now = new Date().toISOString();
      setItems((cur) => cur.map((n) => (n.id === item.id ? { ...n, readAt: now } : n)));
      // Fire-and-forget. If the PATCH fails the optimistic update is
      // a lie until the next refresh — acceptable for a low-stakes
      // read flag.
      void api.patch(`/v1/notifications/${item.id}/read`).catch(() => undefined);
    }
    if (href) {
      router.push(href);
    }
  }

  function handleMarkAll() {
    startBusy(async () => {
      const now = new Date().toISOString();
      setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      try {
        await api.post('/v1/notifications/read-all');
      } catch {
        // Refetch from the server to reconcile if the bulk write fails.
        router.refresh();
      }
    });
  }

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('unreadCount', { count: unreadCount })}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={busy || unreadCount === 0}
        >
          {t('markAll')}
        </Button>
      </div>
      <NotificationInboxList
        items={items.map((n) => ({
          id: n.id,
          topic: n.topic,
          title: n.title,
          body: n.body,
          readAt: n.readAt,
          sentAt: n.sentAt,
          createdAt: n.createdAt,
        }))}
        renderItem={(presentation) => {
          const original = items.find((n) => n.id === presentation.id)!;
          const href = resolveHref(original);
          return (
            <button
              type="button"
              onClick={() => handleRowClick(original)}
              className="block w-full cursor-pointer text-left hover:bg-accent/60"
            >
              <NotificationInboxRow item={presentation} href={href ?? undefined} />
            </button>
          );
        }}
      />
    </div>
  );
}

function resolveHref(notification: Notification): string | null {
  const data = (notification.data ?? {}) as Record<string, unknown>;
  switch (notification.topic) {
    case 'bill.issued':
    case 'bill.paid':
    case 'bill.refunded':
      return typeof data.billId === 'string' ? `/my-bills/${data.billId}` : null;
    case 'ticket.resolved':
      return typeof data.ticketId === 'string' ? `/my-tickets/${data.ticketId}` : null;
    default:
      return null;
  }
}
