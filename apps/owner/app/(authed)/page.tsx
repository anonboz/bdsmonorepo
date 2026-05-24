import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
  const t = await getTranslations('owner.home');
  const tChrome = await getTranslations('owner.chrome');

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

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile titleKey="dashboard" descKey="dashboard" href="/dashboard" />
        <Tile titleKey="houses" descKey="houses" href="/houses" variant="outline" />
        <Tile titleKey="tickets" descKey="tickets" href="/tickets" variant="outline" />
      </div>

      <Tile titleKey="ratings" descKey="ratings" href="/me/ratings" />
      <Tile
        titleKey="partners"
        descKey="partners"
        href="/partners"
        variant="outline"
        cta="browse"
      />
      <Tile titleKey="myBookings" descKey="myBookings" href="/me/service-jobs" variant="outline" />
      <Tile titleKey="charges" descKey="charges" href="/me/charges" variant="outline" />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('tiles.comingSoonTitle')}</CardTitle>
          <CardDescription>{t('tiles.comingSoonDescription')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

function Tile({
  titleKey,
  descKey,
  href,
  variant,
  cta = 'open',
}: {
  titleKey: string;
  descKey: string;
  href: string;
  variant?: 'outline';
  cta?: 'open' | 'browse';
}) {
  const t = useTranslations('owner.home');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`tiles.${titleKey}Title`)}</CardTitle>
        <CardDescription>{t(`tiles.${descKey}Description`)}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant={variant}>
          <Link href={href}>{cta === 'browse' ? t('browse') : t('open')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
