import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { House } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../lib/api';
import { serverApi } from '../../../../../lib/session';
import { HouseForm } from '../../_components/house-form';

export default async function EditHousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const house = await fetchHouse(id);
  if (!house) notFound();

  const t = await getTranslations('owner.houses');
  const tForm = await getTranslations('owner.houses.form');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${house.id}` as const}>{t('backTo', { name: house.name })}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tForm('editTitle')}</h1>
      </div>
      <HouseForm initial={house} />
    </main>
  );
}

async function fetchHouse(id: string): Promise<House | null> {
  try {
    return await serverApi<House>(`/v1/houses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
