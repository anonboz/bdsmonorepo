import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getFormatters } from '@repo/i18n';
import type { House } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ModerationActions } from './moderation-actions';
import { ApiError } from '../../../../lib/api';
import { serverApi } from '../../../../lib/session';
import { ModerationBadge } from '../page';

export default async function AdminHouseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const fmt = getFormatters('en');
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
              <ModerationBadge status={house.moderationStatus} /> ·{' '}
              {house.isPublished ? 'Published' : 'Draft'} · {house.unitCount}{' '}
              {house.unitCount === 1 ? 'unit' : 'units'} · owner{' '}
              <Link href={`/users/${house.ownerId}`} className="underline">
                {house.ownerId}
              </Link>
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Moderation</CardTitle>
          <CardDescription>
            Flag a house to surface a warning to its owner. Reject to remove it from publication.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {house.moderationReason && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current reason
              </p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{house.moderationReason}</p>
              {house.moderationDecidedAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Decided {fmt.formatDateTime(house.moderationDecidedAt)}
                  {house.moderationDecidedBy ? ` by ${house.moderationDecidedBy}` : ''}
                </p>
              )}
            </div>
          )}
          <ModerationActions houseId={house.id} current={house.moderationStatus} />
        </CardContent>
      </Card>

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
          <CardTitle className="text-lg">Audit history</CardTitle>
          <CardDescription>
            <Link href={`/audit-log?target=House%3A${house.id}`} className="underline">
              View all entries targeting this house →
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

async function fetchHouse(id: string): Promise<House | null> {
  try {
    return await serverApi<House>(`/v1/admin/houses/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
