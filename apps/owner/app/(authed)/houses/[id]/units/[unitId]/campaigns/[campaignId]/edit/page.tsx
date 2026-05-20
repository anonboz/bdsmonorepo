import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Campaign } from '@repo/shared';
import { Button } from '@repo/ui';

import { ApiError } from '../../../../../../../../../lib/api';
import { serverApi } from '../../../../../../../../../lib/session';
import { CampaignForm } from '../../_components/campaign-form';

export const metadata = { title: 'Edit campaign' };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; campaignId: string }>;
}) {
  const { id: houseId, unitId, campaignId } = await params;
  const campaign = await fetchCampaign(houseId, unitId, campaignId);
  if (!campaign || (campaign.status !== 'DRAFT' && campaign.status !== 'REJECTED')) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}`}>
            ← Back to campaign
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">Edit campaign</h1>
      </div>

      <CampaignForm houseId={houseId} unitId={unitId} mode="edit" initial={campaign} />
    </main>
  );
}

async function fetchCampaign(
  houseId: string,
  unitId: string,
  campaignId: string,
): Promise<Campaign | null> {
  try {
    return await serverApi<Campaign>(
      `/v1/houses/${houseId}/units/${unitId}/campaigns/${campaignId}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
