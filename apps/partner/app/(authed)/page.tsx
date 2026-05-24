import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { UnreadCountResponse } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NotificationBellLink } from './_components/notification-bell-link';
import { APP_NAME } from '../../lib/app-config';
import { getSession, serverApi } from '../../lib/session';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
  const { unread } = await serverApi<UnreadCountResponse>('/v1/notifications/unread-count').catch(
    () => ({ unread: 0 }),
  );
  const t = await getTranslations('partner.home');
  const tChrome = await getTranslations('partner.chrome');

  const tiles = [
    { key: 'profile', href: '/profile', variant: undefined },
    { key: 'services', href: '/services', variant: undefined },
    { key: 'jobs', href: '/jobs', variant: undefined },
    { key: 'payouts', href: '/payouts', variant: 'outline' as const },
  ];

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{APP_NAME}</h1>
          <p className="text-muted-foreground">
            {tChrome.rich('signedInAs', {
              name: session.user.displayName,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
        <NotificationBellLink initialUnread={unread} />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.key}>
            <CardHeader>
              <CardTitle>{t(`tiles.${tile.key}Title`)}</CardTitle>
              <CardDescription>{t(`tiles.${tile.key}Description`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant={tile.variant}>
                <Link href={tile.href}>{t('open')}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('tiles.comingSoonTitle')}</CardTitle>
          <CardDescription>{t('tiles.comingSoonDescription')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
