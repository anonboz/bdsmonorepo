import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@repo/ui';

import { ServiceForm } from '../_components/service-form';

export async function generateMetadata() {
  const t = await getTranslations('partner.services.form');
  return { title: t('newMetadataTitle') };
}

export default async function NewServicePage() {
  const t = await getTranslations('partner.services');
  const tForm = await getTranslations('partner.services.form');
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/services">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tForm('newTitle')}</h1>
      </div>
      <ServiceForm mode="create" />
    </main>
  );
}
