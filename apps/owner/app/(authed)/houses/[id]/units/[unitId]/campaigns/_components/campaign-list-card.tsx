import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Campaign, CampaignStatus, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../../../../../../lib/session';

export async function CampaignListCard({ houseId, unitId }: { houseId: string; unitId: string }) {
  const page = await serverApi<Page<Campaign>>(
    `/v1/houses/${houseId}/units/${unitId}/campaigns?limit=20`,
  );
  const t = await getTranslations('owner.campaigns');
  const fmt = getFormatters(await getLocale());

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">{t('listTitle')}</CardTitle>
          <CardDescription>
            {page.items.length === 0
              ? t('listEmpty')
              : t('listSummary', { count: page.items.length })}
          </CardDescription>
        </div>
        <Button asChild size="sm">
          <Link href={`/houses/${houseId}/units/${unitId}/campaigns/new`}>{t('newButton')}</Link>
        </Button>
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((c) => (
              <CampaignRow key={c.id} houseId={houseId} unitId={unitId} campaign={c} fmt={fmt} />
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
  fmt,
}: {
  houseId: string;
  unitId: string;
  campaign: Campaign;
  fmt: Formatters;
}) {
  const t = useTranslations('owner.campaigns');
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unitId}/campaigns/${campaign.id}`}
        className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">{campaign.title}</p>
          <p className="text-xs text-muted-foreground">
            {t('campaignMeta', {
              price: fmt.formatMoney(campaign.price, campaign.currency),
              date: fmt.formatDate(campaign.createdAt),
            })}
          </p>
        </div>
        <StatusBadge status={campaign.status} />
      </Link>
    </li>
  );
}

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const t = useTranslations('owner.statuses.campaigns');
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
      {t(status)}
    </span>
  );
}
