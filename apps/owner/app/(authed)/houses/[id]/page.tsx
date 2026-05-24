import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { getFormatters } from '@repo/i18n';
import type { House } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { serverApi } from '../../../../lib/session';
import { DeleteHouseButton } from '../_components/delete-house-button';

export default async function HouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const house = await fetchHouse(id);
  if (!house) notFound();

  const t = await getTranslations('owner.houses');
  const tDetail = await getTranslations('owner.houses.detail');
  const tChrome = await getTranslations('owner.chrome');
  const { formatDateTime } = getFormatters(await getLocale());
  const unitsLabel = t('unitCount', { count: house.unitCount });
  const moderationDecidedAtFormatted = house.moderationDecidedAt
    ? formatDateTime(house.moderationDecidedAt)
    : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/houses">{t('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{house.name}</h1>
            <p className="text-sm text-muted-foreground">
              {house.isPublished
                ? tDetail('subtitlePublished', { units: unitsLabel })
                : tDetail('subtitleDraft', { units: unitsLabel })}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/houses/${house.id}/edit` as const}>{tChrome('edit')}</Link>
            </Button>
            <DeleteHouseButton houseId={house.id} houseName={house.name} />
          </div>
        </div>
      </div>

      <ModerationBanner house={house} decidedAtFormatted={moderationDecidedAtFormatted} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('addressTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>{house.address.line1}</p>
          {house.address.line2 && <p>{house.address.line2}</p>}
          <p>
            {house.address.city}
            {house.address.state ? `, ${house.address.state}` : ''}
            {house.address.postalCode ? ` ${house.address.postalCode}` : ''}
          </p>
          <p>{house.address.country}</p>
        </CardContent>
      </Card>

      {house.description && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('descriptionTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{house.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('unitsTitle')}</CardTitle>
          <CardDescription>
            {house.unitCount === 0
              ? tDetail('unitsEmpty')
              : tDetail('unitsAttached', { count: house.unitCount })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/houses/${house.id}/units`}>
              {house.unitCount === 0 ? tDetail('addUnits') : tDetail('manageUnits')}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function ModerationBanner({
  house,
  decidedAtFormatted,
}: {
  house: House;
  decidedAtFormatted: string | null;
}) {
  const t = useTranslations('owner.houses.moderation');
  if (house.moderationStatus === 'OK') return null;
  const palette =
    house.moderationStatus === 'REJECTED'
      ? 'border-rose-300 bg-rose-50 text-rose-900'
      : 'border-amber-300 bg-amber-50 text-amber-900';
  const heading = house.moderationStatus === 'REJECTED' ? t('rejectedTitle') : t('flaggedTitle');
  const followup =
    house.moderationStatus === 'REJECTED' ? t('rejectedFollowup') : t('flaggedFollowup');
  return (
    <div className={`rounded-lg border px-4 py-3 ${palette}`} role="status">
      <p className="text-sm font-semibold">{heading}</p>
      {house.moderationReason && (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
          {t('reasonPrefix', { reason: house.moderationReason })}
        </p>
      )}
      <p className="mt-1 text-xs opacity-80">
        {followup}
        {decidedAtFormatted ? t('decidedSuffix', { date: decidedAtFormatted }) : ''}
      </p>
    </div>
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
