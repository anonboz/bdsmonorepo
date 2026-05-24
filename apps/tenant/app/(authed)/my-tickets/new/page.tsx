import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Lease, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { NewTicketForm } from './new-ticket-form';
import { serverApi } from '../../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.tickets.new');
  return { title: t('metadataTitle') };
}

export default async function NewTicketPage() {
  const leases = await serverApi<Page<Lease>>('/v1/me/leases?status=ACTIVE&limit=10');
  const t = await getTranslations('tenant.tickets');
  const tNew = await getTranslations('tenant.tickets.new');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-tickets">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tNew('title')}</h1>
      </div>

      {leases.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{tNew('noLeasesTitle')}</CardTitle>
            <CardDescription>{tNew('noLeasesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href="/my-leases">{tNew('viewLeasesButton')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <NewTicketForm leases={leases.items} />
      )}
    </main>
  );
}
