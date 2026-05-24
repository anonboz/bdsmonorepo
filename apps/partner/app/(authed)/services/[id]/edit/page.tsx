import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Service } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';
import { ServiceForm } from '../../_components/service-form';

export async function generateMetadata() {
  const t = await getTranslations('partner.services.form');
  return { title: t('editMetadataTitle') };
}

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = await fetchService(id);
  if (!service) notFound();

  const t = await getTranslations('partner.services.form');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/services/${service.id}`}>{t('backToService')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('editTitle')}</h1>
      </div>
      <ServiceForm mode="edit" initial={service} />
    </main>
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
