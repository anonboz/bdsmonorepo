import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Campaign } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { CampaignActions } from './_components/campaign-actions';
import { DeleteCampaignButton } from './_components/delete-campaign-button';
import { ApiError } from '../../../../../../../../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../lib/session';
import { StatusBadge } from '../_components/campaign-list-card';

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; campaignId: string }>;
}) {
  const { id: houseId, unitId, campaignId } = await params;
  const campaign = await fetchCampaign(houseId, unitId, campaignId);
  if (!campaign) notFound();

  // 4.2: REJECTED is also editable so the owner can fix + re-submit
  // without recreating the listing.
  const canEdit = campaign.status === 'DRAFT' || campaign.status === 'REJECTED';
  const canDelete = campaign.status === 'DRAFT' || campaign.status === 'CLOSED';

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}`}>← Back to unit</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{campaign.title}</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={campaign.status} /> ·{' '}
              {formatMoney(campaign.price, campaign.currency)} · created{' '}
              {formatDate(campaign.createdAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button asChild variant="outline">
                <Link
                  href={`/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}/edit` as const}
                >
                  Edit
                </Link>
              </Button>
            )}
            {canDelete && (
              <DeleteCampaignButton
                houseId={houseId}
                unitId={unitId}
                campaignId={campaign.id}
                campaignTitle={campaign.title}
              />
            )}
          </div>
        </div>
      </div>

      {campaign.status === 'REJECTED' && campaign.moderationReason && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          role="status"
        >
          <p className="text-sm font-semibold">Rejected by an admin</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            Reason: {campaign.moderationReason}
          </p>
          {campaign.moderationDecidedAt && (
            <p className="mt-1 text-xs opacity-80">
              Decided {formatDateTime(campaign.moderationDecidedAt)}.
            </p>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Listing</CardTitle>
          <CardDescription>How prospects will see it once approved.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{campaign.body}</p>
          {campaign.photos.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {campaign.photos.map((url) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={url} src={url} alt="" className="aspect-video rounded-md object-cover" />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
          <CardDescription>{actionsCopy(campaign)}</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignActions houseId={houseId} unitId={unitId} campaign={campaign} />
        </CardContent>
      </Card>
    </main>
  );
}

function actionsCopy(c: Campaign): string {
  switch (c.status) {
    case 'DRAFT':
      return 'Submit when you are happy with the listing. Unit must be vacant.';
    case 'PENDING':
      return 'Waiting on admin review. Withdraw to keep editing.';
    case 'LIVE':
      return 'Listing is public. Close when you have found a tenant.';
    case 'CLOSED':
      return 'Closed listing — keep for the record or delete.';
    case 'REJECTED':
      return 'Rejected. Address the reason above and create a new draft.';
    case 'EXPIRED':
      return 'Auto-expired. Create a new draft to re-list.';
  }
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
