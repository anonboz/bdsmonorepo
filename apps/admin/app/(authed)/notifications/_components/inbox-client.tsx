'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { Notification, Page } from '@repo/shared';
import { Button, NotificationInboxList, NotificationInboxRow } from '@repo/ui';

import { api } from '../../../../lib/api';

export function InboxClient({ initial }: { initial: Page<Notification> }) {
  const [items, setItems] = useState(initial.items);
  const [busy, startBusy] = useTransition();
  const router = useRouter();

  function handleRowClick(item: Notification) {
    if (!item.readAt) {
      const now = new Date().toISOString();
      setItems((cur) => cur.map((n) => (n.id === item.id ? { ...n, readAt: now } : n)));
      void api.patch(`/v1/notifications/${item.id}/read`).catch(() => undefined);
    }
    // Admin has no domain-side deep links from 8.2 dispatches; the
    // inbox stays in place after a click. When future admin-targeted
    // topics ship, fill in the resolver below.
  }

  function handleMarkAll() {
    startBusy(async () => {
      const now = new Date().toISOString();
      setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: now })));
      try {
        await api.post('/v1/notifications/read-all');
      } catch {
        router.refresh();
      }
    });
  }

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={handleMarkAll}
          disabled={busy || unreadCount === 0}
        >
          Mark all as read
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
          return (
            <button
              type="button"
              onClick={() => handleRowClick(original)}
              className="block w-full cursor-pointer text-left hover:bg-accent/60"
            >
              <NotificationInboxRow item={presentation} />
            </button>
          );
        }}
      />
    </div>
  );
}
