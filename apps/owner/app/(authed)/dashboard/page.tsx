import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { BillDashboardItem, OwnerDashboard } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.dashboard');
  return { title: t('metadataTitle') };
}

export default async function DashboardPage() {
  const data = await serverApi<OwnerDashboard>('/v1/me/owner-dashboard');
  const t = await getTranslations('owner.dashboard');

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {data.counts.houses === 0 ? (
        <EmptyState />
      ) : (
        <>
          <StatsGrid data={data} />
          <div className="grid gap-6 lg:grid-cols-2">
            <OverdueCard items={data.overdueBills} totalCount={data.counts.overdueBills} />
            <RecentCard items={data.recentBills} />
          </div>
        </>
      )}
    </main>
  );
}

function StatsGrid({ data }: { data: OwnerDashboard }) {
  const t = useTranslations('owner.dashboard.stats');
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title={t('occupancyTitle')}
        value={formatPercent(data.occupancy.rate)}
        sub={t('occupancySub', { occupied: data.occupancy.occupied, total: data.occupancy.total })}
      />
      <StatCard
        title={t('mrrTitle')}
        value={data.mrr[0] ? formatMoney(data.mrr[0].amount, data.mrr[0].currency) : '—'}
        sub={
          data.mrr.length > 1
            ? data.mrr
                .slice(1)
                .map((m) => formatMoney(m.amount, m.currency))
                .join(' · ')
            : t('mrrSubMonthly')
        }
      />
      <StatCard
        title={t('activeLeasesTitle')}
        value={String(data.counts.activeLeases)}
        sub={t('activeLeasesSub', { count: data.counts.tenants })}
      />
      <StatCard
        title={t('overdueTitle')}
        value={String(data.counts.overdueBills)}
        sub={
          data.counts.overdueBills === 0
            ? t('overdueClear')
            : t('overdueSub', { houses: data.counts.houses, units: data.counts.units })
        }
        tone={data.counts.overdueBills > 0 ? 'warn' : undefined}
      />
    </div>
  );
}

function StatCard({
  title,
  value,
  sub,
  tone,
}: {
  title: string;
  value: string;
  sub: string;
  tone?: 'warn';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="text-xs uppercase tracking-wide">{title}</CardDescription>
      </CardHeader>
      <CardContent>
        <p
          className={`text-3xl font-semibold leading-tight ${tone === 'warn' ? 'text-destructive' : ''}`}
        >
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function OverdueCard({ items, totalCount }: { items: BillDashboardItem[]; totalCount: number }) {
  const t = useTranslations('owner.dashboard');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('overdueTitle')}</CardTitle>
        <CardDescription>
          {totalCount === 0
            ? t('overdueEmpty')
            : t('overdueSummary', { count: totalCount, latest: Math.min(items.length, 10) })}
        </CardDescription>
      </CardHeader>
      {items.length > 0 && (
        <CardContent>
          <BillsTable items={items} highlightDue />
        </CardContent>
      )}
    </Card>
  );
}

function RecentCard({ items }: { items: BillDashboardItem[] }) {
  const t = useTranslations('owner.dashboard');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('recentTitle')}</CardTitle>
        <CardDescription>
          {items.length === 0 ? t('recentEmpty') : t('recentSummary', { count: items.length })}
        </CardDescription>
      </CardHeader>
      {items.length > 0 && (
        <CardContent>
          <BillsTable items={items} />
        </CardContent>
      )}
    </Card>
  );
}

function BillsTable({
  items,
  highlightDue = false,
}: {
  items: BillDashboardItem[];
  highlightDue?: boolean;
}) {
  const t = useTranslations('owner.dashboard.billsTable');
  const tStatus = useTranslations('owner.statuses.bills');
  return (
    <ul className="divide-y text-sm">
      {items.map((b) => (
        <li key={b.id}>
          <Link
            href={`/houses/${b.houseId}/units/${b.unitId}/leases/${b.leaseId}/bills/${b.id}`}
            className="-mx-2 flex items-center justify-between gap-3 rounded px-2 py-3 transition-colors hover:bg-accent/40"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">
                {t('headLeft', { unitLabel: b.unitLabel, houseName: b.houseName })}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {t('headRight', {
                  tenantName: b.tenantName,
                  periodStart: formatDate(b.periodStart),
                  periodEnd: formatDate(b.periodEnd),
                })}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatMoney(b.total, b.currency)}</p>
              <p
                className={`text-xs ${highlightDue ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {highlightDue ? t('duePrefix') : ''}
                {t('dueAndStatus', { date: formatDate(b.dueDate), status: tStatus(b.status) })}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function EmptyState() {
  const t = useTranslations('owner.dashboard');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('emptyTitle')}</CardTitle>
        <CardDescription>{t('emptyDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/houses/new" className="text-sm font-medium underline">
          {t('emptyCta')}
        </Link>
      </CardContent>
    </Card>
  );
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
