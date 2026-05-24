import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Unit } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../../../../lib/api';
import { serverApi } from '../../../../../../../../lib/session';
import { CampaignForm } from '../_components/campaign-form';

export async function generateMetadata() {
  const t = await getTranslations('owner.campaigns.form');
  return { title: t('newMetadata') };
}

export default async function NewCampaignPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id: houseId, unitId } = await params;
  const unit = await fetchUnit(houseId, unitId);
  if (!unit) notFound();

  const t = await getTranslations('owner.units');
  const tForm = await getTranslations('owner.campaigns.form');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}`}>
            {t('backToUnit', { label: unit.label })}
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tForm('newTitle')}</h1>
        <p className="text-sm text-muted-foreground">{tForm('newSubtitle')}</p>
      </div>

      <CampaignForm houseId={houseId} unitId={unitId} mode="create" />
    </main>
  );
}

async function fetchUnit(houseId: string, unitId: string): Promise<Unit | null> {
  try {
    return await serverApi<Unit>(`/v1/houses/${houseId}/units/${unitId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
