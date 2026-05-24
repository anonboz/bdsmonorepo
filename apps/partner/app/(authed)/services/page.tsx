import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { Page, Service } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../lib/api';
import { formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('partner.services');
  return { title: t('metadataTitle') };
}

export default async function ServicesPage() {
  const page = await fetchServices();
  const t = await getTranslations('partner.services');
  const tChrome = await getTranslations('partner.chrome');

  const summary =
    page === null
      ? t('summaryNoProfile')
      : page.items.length === 0
        ? t('summaryEmpty')
        : t('summaryCount', { count: page.items.length });

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </div>
          {page !== null && (
            <Button asChild>
              <Link href="/services/new">{t('newButton')}</Link>
            </Button>
          )}
        </div>
      </div>

      {page === null ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('profileRequiredTitle')}</CardTitle>
            <CardDescription>
              <Link href="/profile" className="underline">
                {t('profileRequiredLink')}
              </Link>
              {t('profileRequiredSuffix')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((s) => (
            <ServiceRow key={s.id} service={s} />
          ))}
        </ul>
      )}
    </main>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const t = useTranslations('partner.services');
  return (
    <li>
      <Link
        href={`/services/${service.id}`}
        className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">{service.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('metaLine', {
                price: formatMoney(service.basePrice, service.currency),
                state: service.isActive ? t('stateActive') : t('stateInactive'),
              })}
            </p>
          </div>
        </div>
        {service.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed">{service.description}</p>
        )}
      </Link>
    </li>
  );
}

async function fetchServices(): Promise<Page<Service> | null> {
  try {
    return await serverApi<Page<Service>>('/v1/me/services');
  } catch (err) {
    // The service returns 422 partners.profile_not_found when the partner
    // hasn't published a profile yet — show the empty-state instead.
    if (err instanceof ApiError && err.status === 422) return null;
    throw err;
  }
}
