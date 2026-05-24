import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { PublicCampaign } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApplyForm } from './apply-form';
import { ApiError, apiFetch } from '../../../lib/api';
import { formatDate, formatMoney } from '../../../lib/format';
import { getSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function BrowseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, session] = await Promise.all([fetchPublic(id), getSession()]);
  if (!campaign) notFound();

  const isTenant = Boolean(session?.user.roles.includes('TENANT'));
  const isOwnerOfCampaign = session?.user.id === campaign.ownerId;
  const t = await getTranslations('tenant.browse');
  const tDetail = await getTranslations('tenant.browse.detail');

  const applyDescription = isOwnerOfCampaign
    ? tDetail('applyOwner')
    : isTenant
      ? tDetail('applyTenant')
      : session
        ? tDetail('applyOtherRole')
        : tDetail('applyAnon');

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/browse">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{campaign.title}</h1>
        <p className="text-sm text-muted-foreground">
          {tDetail('subtitle', {
            city: campaign.house.city,
            country: campaign.house.country,
            price: formatMoney(campaign.price, campaign.currency),
            date: formatDate(campaign.publishedAt),
          })}
        </p>
      </div>

      {campaign.photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {campaign.photos.map((url) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={url} src={url} alt="" className="aspect-video rounded-md object-cover" />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('aboutTitle')}</CardTitle>
          <CardDescription>
            <AboutLine
              label={campaign.unit.label}
              sqm={campaign.unit.sqm ?? null}
              bedrooms={campaign.unit.bedrooms ?? null}
              bathrooms={campaign.unit.bathrooms ?? null}
            />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{campaign.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('applyTitle')}</CardTitle>
          <CardDescription>{applyDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {isTenant && !isOwnerOfCampaign ? (
            <ApplyForm campaignId={campaign.id} />
          ) : (
            !session && (
              <Button asChild>
                <Link href={`/login?next=${encodeURIComponent(`/browse/${id}`)}`}>
                  {tDetail('signInToApply')}
                </Link>
              </Button>
            )
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function AboutLine({
  label,
  sqm,
  bedrooms,
  bathrooms,
}: {
  label: string;
  sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}) {
  const t = useTranslations('tenant.browse');
  return (
    <>
      {label}
      {sqm != null ? t('sqmSuffix', { n: sqm }) : ''}
      {bedrooms != null ? t('brSuffix', { n: bedrooms }) : ''}
      {bathrooms != null ? t('baSuffix', { n: bathrooms }) : ''}
    </>
  );
}

async function fetchPublic(id: string): Promise<PublicCampaign | null> {
  try {
    return await apiFetch<PublicCampaign>(`/v1/public/campaigns/${id}`, { cache: 'no-store' });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
