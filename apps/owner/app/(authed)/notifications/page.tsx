import type { Notification, Page } from '@repo/shared';

import { InboxClient } from './_components/inbox-client';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Notifications' };

export default async function NotificationsPage() {
  const initial = await serverApi<Page<Notification>>('/v1/notifications?limit=20');
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Updates about your tickets, jobs, and account.
        </p>
      </header>
      <InboxClient initial={initial} />
    </main>
  );
}
