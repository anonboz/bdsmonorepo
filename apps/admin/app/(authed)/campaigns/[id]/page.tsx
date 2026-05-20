import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Campaign } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ModerationActions } from './moderation-actions';
import { ApiError } from '../../../../lib/api';
import { formatDateTime, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';
import { Badge } from '../page';

export default async function AdminCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaign = await fetchCampaign(id);
  if (!campaign) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/campaigns">← Back to campaigns</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{campaign.title}</h1>
            <p className="text-sm text-muted-foreground">
              <Badge status={campaign.status} /> · {formatMoney(campaign.price, campaign.currency)}{' '}
              · owner{' '}
              <Link href={`/users/${campaign.ownerId}`} className="underline">
                {campaign.ownerId}
              </Link>
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Moderation</CardTitle>
          <CardDescription>
            Approve to publish the listing. Reject with a reason that the owner will see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {campaign.moderationReason && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Current decision
              </p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                {campaign.moderationReason}
              </p>
              {campaign.moderationDecidedAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Decided {formatDateTime(campaign.moderationDecidedAt)}
                  {campaign.moderationDecidedBy ? ` by ${campaign.moderationDecidedBy}` : ''}
                </p>
              )}
            </div>
          )}
          <ModerationActions campaignId={campaign.id} status={campaign.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Listing</CardTitle>
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
          <CardTitle className="text-lg">Audit history</CardTitle>
          <CardDescription>
            <Link href={`/audit-log?target=Campaign%3A${campaign.id}`} className="underline">
              View all entries targeting this campaign →
            </Link>
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}

async function fetchCampaign(id: string): Promise<Campaign | null> {
  try {
    return await serverApi<Campaign>(`/v1/admin/campaigns/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
