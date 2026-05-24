import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { Button } from '@repo/ui';

import { HouseForm } from '../_components/house-form';

export async function generateMetadata() {
  const t = await getTranslations('owner.houses.form');
  return { title: t('newMetadata') };
}

export default async function NewHousePage() {
  const t = await getTranslations('owner.houses');
  const tForm = await getTranslations('owner.houses.form');
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/houses">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tForm('newTitle')}</h1>
      </div>
      <HouseForm />
    </main>
  );
}
