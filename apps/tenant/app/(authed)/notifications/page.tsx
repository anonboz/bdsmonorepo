import { getTranslations } from 'next-intl/server';

import type { Notification, Page } from '@repo/shared';

import { InboxClient } from './_components/inbox-client';
import { PreferencesCard } from './_components/preferences-card';
import { PushToggle } from './_components/push-toggle';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.notifications');
  return { title: t('metadataTitle') };
}

export default async function NotificationsPage() {
  // First-page hydration is server-rendered so the inbox is usable
  // pre-JS. The client island takes over for mark-read mutations.
  const initial = await serverApi<Page<Notification>>('/v1/notifications?limit=20');
  const t = await getTranslations('tenant.notifications');
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <InboxClient initial={initial} />
      <PreferencesCard />
      <PushToggle />
    </main>
  );
}
