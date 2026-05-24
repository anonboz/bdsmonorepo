import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type useTranslations as useTranslationsType, useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Campaign, CampaignStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApplicationsPanel } from './_components/applications-panel';
import { CampaignActions } from './_components/campaign-actions';
import { DeleteCampaignButton } from './_components/delete-campaign-button';
import { ApiError } from '../../../../../../../../lib/api';
import { serverApi } from '../../../../../../../../lib/session';
import { StatusBadge } from '../_components/campaign-list-card';

type Translator = ReturnType<typeof useTranslationsType>;

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; campaignId: string }>;
}) {
  const { id: houseId, unitId, campaignId } = await params;
  const campaign = await fetchCampaign(houseId, unitId, campaignId);
  if (!campaign) notFound();

  const canEdit = campaign.status === 'DRAFT' || campaign.status === 'REJECTED';
  const canDelete = campaign.status === 'DRAFT' || campaign.status === 'CLOSED';

  const t = await getTranslations('owner.campaigns.detail');
  const tChrome = await getTranslations('owner.chrome');
  const fmt = getFormatters(await getLocale());
  const { formatDateTime } = fmt;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}`}>{tChrome('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{campaign.title}</h1>
            <SubtitleLine campaign={campaign} fmt={fmt} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button asChild variant="outline">
                <Link
                  href={`/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}/edit` as const}
                >
                  {tChrome('edit')}
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
          <p className="text-sm font-semibold">{t('rejectedTitle')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {t('rejectedReason', { reason: campaign.moderationReason })}
          </p>
          {campaign.moderationDecidedAt && (
            <p className="mt-1 text-xs opacity-80">
              {t('decidedSuffix', { date: formatDateTime(campaign.moderationDecidedAt) })}
            </p>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('listingTitle')}</CardTitle>
          <CardDescription>{t('listingSubtitle')}</CardDescription>
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
          <CardTitle className="text-lg">{t('actionsTitle')}</CardTitle>
          <CardDescription>{actionsCopyKey(campaign.status, t)}</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignActions houseId={houseId} unitId={unitId} campaign={campaign} />
        </CardContent>
      </Card>

      <ApplicationsPanel houseId={houseId} unitId={unitId} campaign={campaign} />
    </main>
  );
}

function SubtitleLine({ campaign, fmt }: { campaign: Campaign; fmt: Formatters }) {
  const t = useTranslations('owner.campaigns.detail');
  return (
    <p className="text-sm text-muted-foreground">
      <StatusBadge status={campaign.status} /> ·{' '}
      {t('subtitle', {
        price: fmt.formatMoney(campaign.price, campaign.currency),
        date: fmt.formatDate(campaign.createdAt),
      })}
    </p>
  );
}

function actionsCopyKey(status: CampaignStatus, t: Translator): string {
  switch (status) {
    case 'DRAFT':
      return t('actionsCopyDraft');
    case 'PENDING':
      return t('actionsCopyPending');
    case 'LIVE':
      return t('actionsCopyLive');
    case 'CLOSED':
      return t('actionsCopyClosed');
    case 'REJECTED':
      return t('actionsCopyRejected');
    case 'EXPIRED':
      return t('actionsCopyExpired');
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
