import Link from 'next/link';

import type { Campaign, CampaignStatus, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate, formatMoney } from '../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../lib/session';

export async function CampaignListCard({ houseId, unitId }: { houseId: string; unitId: string }) {
  const page = await serverApi<Page<Campaign>>(
    `/v1/houses/${houseId}/units/${unitId}/campaigns?limit=20`,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">Campaigns</CardTitle>
          <CardDescription>
            {page.items.length === 0
              ? 'No campaigns yet on this unit.'
              : `${page.items.length} ${page.items.length === 1 ? 'campaign' : 'campaigns'}, including history.`}
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/houses/${houseId}/units/${unitId}/campaigns/new`}>New campaign</Link>
        </Button>
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((c) => (
              <CampaignRow key={c.id} houseId={houseId} unitId={unitId} campaign={c} />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function CampaignRow({
  houseId,
  unitId,
  campaign,
}: {
  houseId: string;
  unitId: string;
  campaign: Campaign;
}) {
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}`}
        className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">{campaign.title}</p>
          <p className="text-xs text-muted-foreground">
            {formatMoney(campaign.price, campaign.currency)} · created{' '}
            {formatDate(campaign.createdAt)}
          </p>
        </div>
        <StatusBadge status={campaign.status} />
      </Link>
    </li>
  );
}

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const palette: Record<CampaignStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    PENDING: 'bg-amber-100 text-amber-900',
    LIVE: 'bg-emerald-100 text-emerald-900',
    CLOSED: 'bg-zinc-200 text-zinc-700',
    REJECTED: 'bg-rose-100 text-rose-900',
    EXPIRED: 'bg-zinc-200 text-zinc-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}
