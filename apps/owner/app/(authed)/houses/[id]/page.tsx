import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { House } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { formatDateTime } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';
import { DeleteHouseButton } from '../_components/delete-house-button';

export default async function HouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const house = await fetchHouse(id);
  if (!house) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/houses">← Back to houses</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{house.name}</h1>
            <p className="text-sm text-muted-foreground">
              {house.unitCount} {house.unitCount === 1 ? 'unit' : 'units'}
              {house.isPublished ? ' · Published' : ' · Draft'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/houses/${house.id}/edit` as const}>Edit</Link>
            </Button>
            <DeleteHouseButton houseId={house.id} houseName={house.name} />
          </div>
        </div>
      </div>

      <ModerationBanner house={house} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Address</CardTitle>
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
            <CardTitle className="text-lg">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{house.description}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Units</CardTitle>
          <CardDescription>
            {house.unitCount === 0
              ? 'No units yet.'
              : `${house.unitCount} ${house.unitCount === 1 ? 'unit' : 'units'} attached.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/houses/${house.id}/units`}>
              {house.unitCount === 0 ? 'Add units' : 'Manage units'}
            </Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

function ModerationBanner({ house }: { house: House }) {
  if (house.moderationStatus === 'OK') return null;
  const palette =
    house.moderationStatus === 'REJECTED'
      ? 'border-rose-300 bg-rose-50 text-rose-900'
      : 'border-amber-300 bg-amber-50 text-amber-900';
  const heading =
    house.moderationStatus === 'REJECTED'
      ? 'Listing rejected by an admin'
      : 'Listing flagged for review';
  const followup =
    house.moderationStatus === 'REJECTED'
      ? 'Your listing has been removed from publication. Address the reason below and contact support to re-list.'
      : 'You can still manage the house, but it will be hidden from public listings until the issue is resolved.';
  return (
    <div className={`rounded-lg border px-4 py-3 ${palette}`} role="status">
      <p className="text-sm font-semibold">{heading}</p>
      {house.moderationReason && (
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
          Reason: {house.moderationReason}
        </p>
      )}
      <p className="mt-1 text-xs opacity-80">
        {followup}
        {house.moderationDecidedAt
          ? ` · Decided ${formatDateTime(house.moderationDecidedAt)}.`
          : ''}
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
