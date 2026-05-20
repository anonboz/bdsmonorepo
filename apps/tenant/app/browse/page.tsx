import Link from 'next/link';

import type { Page, PublicCampaign } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { apiFetch } from '../../lib/api';
import { formatMoney } from '../../lib/format';

export const metadata = { title: 'Browse listings' };

type SearchParams = Promise<{
  q?: string;
  city?: string;
  country?: string;
  minPrice?: string;
  maxPrice?: string;
}>;

export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ limit: '20' });
  if (sp.q) qs.set('q', sp.q);
  if (sp.city) qs.set('city', sp.city);
  if (sp.country) qs.set('country', sp.country);
  if (sp.minPrice) qs.set('minPrice', sp.minPrice);
  if (sp.maxPrice) qs.set('maxPrice', sp.maxPrice);

  // Public endpoint — no cookies forwarded; works pre-login.
  const page = await apiFetch<Page<PublicCampaign>>(`/v1/public/campaigns?${qs}`, {
    cache: 'no-store',
  });

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Browse listings</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0 ? 'No listings match.' : `${page.items.length} listings.`}
        </p>
      </header>

      <FilterBar current={sp} />

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>Try widening your filters or checking back later.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((c) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterBar({
  current,
}: {
  current: { q?: string; city?: string; country?: string; minPrice?: string; maxPrice?: string };
}) {
  return (
    <form className="grid gap-2 sm:grid-cols-3">
      <input
        name="q"
        defaultValue={current.q ?? ''}
        placeholder="Search title"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm sm:col-span-2"
      />
      <input
        name="city"
        defaultValue={current.city ?? ''}
        placeholder="City"
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <input
        name="country"
        defaultValue={current.country ?? ''}
        placeholder="Country (ISO)"
        maxLength={2}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <input
        name="minPrice"
        defaultValue={current.minPrice ?? ''}
        placeholder="Min price (minor units)"
        type="number"
        min={0}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <input
        name="maxPrice"
        defaultValue={current.maxPrice ?? ''}
        placeholder="Max price (minor units)"
        type="number"
        min={0}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
    </form>
  );
}

function CampaignCard({ campaign }: { campaign: PublicCampaign }) {
  const cover = campaign.photos[0];
  return (
    <li>
      <Link
        href={`/browse/${campaign.id}`}
        className="block overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="grid grid-cols-3">
          <div className="col-span-1 bg-muted">
            {cover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cover} alt="" className="aspect-video h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
                No photo
              </div>
            )}
          </div>
          <div className="col-span-2 space-y-1 p-4">
            <p className="font-semibold">{campaign.title}</p>
            <p className="text-sm text-muted-foreground">
              {campaign.house.city}, {campaign.house.country}
              {campaign.unit.sqm ? ` · ${campaign.unit.sqm} m²` : ''}
              {campaign.unit.bedrooms != null ? ` · ${campaign.unit.bedrooms} BR` : ''}
            </p>
            <p className="text-sm font-medium">
              {formatMoney(campaign.price, campaign.currency)} / month
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}
