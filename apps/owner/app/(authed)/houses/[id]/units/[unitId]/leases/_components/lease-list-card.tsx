import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { Lease, LeaseStatus, Page } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate, formatMoney } from '../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../lib/session';

export async function LeaseListCard({ houseId, unitId }: { houseId: string; unitId: string }) {
  const page = await serverApi<Page<Lease>>(
    `/v1/houses/${houseId}/units/${unitId}/leases?limit=20`,
  );
  const t = await getTranslations('owner.leases');

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
          <Link href={`/houses/${houseId}/units/${unitId}/leases/new`}>{t('newButton')}</Link>
        </Button>
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((lease) => (
              <LeaseRow key={lease.id} houseId={houseId} unitId={unitId} lease={lease} />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function LeaseRow({ houseId, unitId, lease }: { houseId: string; unitId: string; lease: Lease }) {
  const t = useTranslations('owner.leases');
  const tCycle = useTranslations('owner.statuses.rentCyclesLower');
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unitId}/leases/${lease.id}`}
        className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">
            {t('rentPerCycle', {
              amount: formatMoney(lease.rentAmount, lease.currency),
              cycle: tCycle(lease.rentCycle),
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
          </p>
        </div>
        <StatusBadge status={lease.status} />
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: LeaseStatus }) {
  const t = useTranslations('owner.statuses.leases');
  const palette: Record<LeaseStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ACTIVE: 'bg-emerald-100 text-emerald-900',
    ENDED: 'bg-zinc-200 text-zinc-700',
    TERMINATED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
    </span>
  );
}
