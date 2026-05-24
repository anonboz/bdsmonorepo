import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { House, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.houses');
  return { title: t('metadataTitle') };
}

export default async function HousesPage() {
  const page = await serverApi<Page<House>>('/v1/houses?limit=50');
  const t = await getTranslations('owner.houses');

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('summaryCount', { count: page.items.length })}
          </p>
        </div>
        <Button asChild>
          <Link href="/houses/new">{t('newButton')}</Link>
        </Button>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/houses/new">{t('emptyCta')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {page.items.map((house) => (
            <HouseCard key={house.id} house={house} />
          ))}
        </ul>
      )}
    </main>
  );
}

function HouseCard({ house }: { house: House }) {
  const t = useTranslations('owner.houses');
  return (
    <li>
      <Link
        href={`/houses/${house.id}` as const}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold leading-tight">{house.name}</h2>
            {house.isPublished && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t('publishedBadge')}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {house.address.city}, {house.address.country}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('unitCount', { count: house.unitCount })}
          </p>
        </div>
      </Link>
    </li>
  );
}
