import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { UnreadCountResponse } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NotificationBellLink } from './_components/notification-bell-link';
import { APP_NAME, AUTH_PASSWORD_ENABLED } from '../../lib/app-config';
import { getSession, serverApi } from '../../lib/session';

export default async function HomePage() {
  // Guarded by (authed)/layout — session is guaranteed.
  const session = (await getSession())!;
  // SSR the initial unread count so the bell renders correctly before
  // hydration; the client island takes over for polling.
  const { unread } = await serverApi<UnreadCountResponse>('/v1/notifications/unread-count').catch(
    () => ({ unread: 0 }),
  );

  const t = await getTranslations('tenant.home');
  const tChrome = await getTranslations('tenant.chrome');
  const tiles = [
    { key: 'leases', href: '/my-leases', variant: undefined },
    { key: 'bills', href: '/my-bills', variant: undefined },
    { key: 'tickets', href: '/my-tickets', variant: undefined },
  ] as const;

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

      {AUTH_PASSWORD_ENABLED && !session.hasPassword && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('passwordNudge.title')}</CardTitle>
            <CardDescription>{t('passwordNudge.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/set-password">{t('passwordNudge.cta')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.key}>
            <CardHeader>
              <CardTitle>{t(`tiles.${tile.key}Title`)}</CardTitle>
              <CardDescription>{t(`tiles.${tile.key}Description`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href={tile.href}>{t('open')}</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('tiles.ratingsTitle')}</CardTitle>
          <CardDescription>{t('tiles.ratingsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/me/ratings">{t('open')}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('tiles.browseTitle')}</CardTitle>
          <CardDescription>{t('tiles.browseDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/browse">{t('open')}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('tiles.applicationsTitle')}</CardTitle>
          <CardDescription>{t('tiles.applicationsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/me/applications">{t('open')}</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('tiles.comingSoonTitle')}</CardTitle>
          <CardDescription>{t('tiles.comingSoonDescription')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
