import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { PublicCampaign } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError, apiFetch } from '../../../lib/api';
import { formatDate, formatMoney } from '../../../lib/format';
import { getSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

export default async function BrowseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, session] = await Promise.all([fetchPublic(id), getSession()]);
  if (!campaign) notFound();

  // 4.4 will land the apply form; for now the CTA either invites sign-in
  // or shows a placeholder for tenants until applications go live.
  const applyHref = session ? '#' : `/login?next=${encodeURIComponent(`/browse/${id}`)}`;
  const applyDisabled = Boolean(session);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/browse">← Back to listings</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{campaign.title}</h1>
        <p className="text-sm text-muted-foreground">
          {campaign.house.city}, {campaign.house.country} ·{' '}
          {formatMoney(campaign.price, campaign.currency)} / month · published{' '}
          {formatDate(campaign.publishedAt)}
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
          <CardTitle className="text-lg">About this place</CardTitle>
          <CardDescription>
            {campaign.unit.label}
            {campaign.unit.sqm ? ` · ${campaign.unit.sqm} m²` : ''}
            {campaign.unit.bedrooms != null ? ` · ${campaign.unit.bedrooms} BR` : ''}
            {campaign.unit.bathrooms != null ? ` · ${campaign.unit.bathrooms} BA` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{campaign.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Apply</CardTitle>
          <CardDescription>
            {session
              ? 'Applications open up here in the next release.'
              : 'Sign in to apply for this listing.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild disabled={applyDisabled}>
            <Link href={applyHref}>{session ? 'Apply (coming soon)' : 'Sign in to apply'}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
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
