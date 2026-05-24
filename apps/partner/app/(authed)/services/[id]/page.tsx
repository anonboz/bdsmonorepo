import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { getFormatters } from '@repo/i18n';
import type { Service } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { DeleteServiceButton } from './delete-service-button';
import { ApiError } from '../../../../lib/api';
import { serverApi } from '../../../../lib/session';

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await fetchService(id);
  if (!service) notFound();

  const t = await getTranslations('partner.services');
  const tDetail = await getTranslations('partner.services.detail');
  const { formatMoney } = getFormatters(await getLocale());
  const priceFormatted = formatMoney(service.basePrice, service.currency);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/services">{t('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{service.name}</h1>
            <MetaLine service={service} priceFormatted={priceFormatted} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href={`/services/${service.id}/edit`}>{tDetail('editButton')}</Link>
            </Button>
            <DeleteServiceButton serviceId={service.id} serviceName={service.name} />
          </div>
        </div>
      </div>

      {service.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('descriptionTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{service.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('bookingsTitle')}</CardTitle>
          <CardDescription>{tDetail('bookingsDescription')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

function MetaLine({ service, priceFormatted }: { service: Service; priceFormatted: string }) {
  const t = useTranslations('partner.services');
  return (
    <p className="text-sm text-muted-foreground">
      {t('metaLine', {
        price: priceFormatted,
        state: service.isActive ? t('stateActive') : t('stateInactive'),
      })}
    </p>
  );
}

async function fetchService(id: string): Promise<Service | null> {
  try {
    return await serverApi<Service>(`/v1/me/services/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
