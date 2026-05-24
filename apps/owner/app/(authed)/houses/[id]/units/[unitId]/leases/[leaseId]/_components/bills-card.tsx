import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Bill, BillStatus, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { GenerateNowButton } from './generate-now-button';
import { serverApi } from '../../../../../../../../../lib/session';

export async function BillsCard({
  houseId,
  unitId,
  leaseId,
  leaseStatus,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  leaseStatus: string;
}) {
  const page = await serverApi<Page<Bill>>(
    `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills?limit=20`,
  );
  const isActive = leaseStatus === 'ACTIVE';
  const t = await getTranslations('owner.bills');
  const fmt = getFormatters(await getLocale());

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">{t('listTitle')}</CardTitle>
          <CardDescription>
            {page.items.length === 0
              ? isActive
                ? t('listEmptyActive')
                : t('listEmptyInactive')
              : t('listSummary', { count: page.items.length })}
          </CardDescription>
        </div>
        {isActive && <GenerateNowButton houseId={houseId} unitId={unitId} leaseId={leaseId} />}
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((bill) => (
              <BillRow
                key={bill.id}
                houseId={houseId}
                unitId={unitId}
                leaseId={leaseId}
                bill={bill}
                fmt={fmt}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function BillRow({
  houseId,
  unitId,
  leaseId,
  bill,
  fmt,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  bill: Bill;
  fmt: Formatters;
}) {
  const t = useTranslations('owner.bills');
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${bill.id}`}
        className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">{fmt.formatMoney(bill.total, bill.currency)}</p>
          <p className="text-xs text-muted-foreground">
            {fmt.formatDate(bill.periodStart)} – {fmt.formatDate(bill.periodEnd)} ·{' '}
            {t('billDuePrefix', { date: fmt.formatDate(bill.dueDate) })}
          </p>
        </div>
        <StatusBadge status={bill.status} />
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const t = useTranslations('owner.statuses.bills');
  const palette: Record<BillStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ISSUED: 'bg-blue-100 text-blue-900',
    PARTIALLY_PAID: 'bg-amber-100 text-amber-900',
    PAID: 'bg-emerald-100 text-emerald-900',
    OVERDUE: 'bg-rose-100 text-rose-900',
    VOID: 'bg-zinc-200 text-zinc-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
    </span>
  );
}
