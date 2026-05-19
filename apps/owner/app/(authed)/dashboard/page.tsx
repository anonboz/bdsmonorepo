import Link from 'next/link';

import type { BillDashboardItem, BillStatus, OwnerDashboard } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const data = await serverApi<OwnerDashboard>('/v1/me/owner-dashboard');

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your portfolio at a glance.</p>
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
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Occupancy"
        value={formatPercent(data.occupancy.rate)}
        sub={`${data.occupancy.occupied} of ${data.occupancy.total} units`}
      />
      <StatCard
        title="MRR"
        value={data.mrr[0] ? formatMoney(data.mrr[0].amount, data.mrr[0].currency) : '—'}
        sub={
          data.mrr.length > 1
            ? data.mrr
                .slice(1)
                .map((m) => formatMoney(m.amount, m.currency))
                .join(' · ')
            : 'monthly recurring'
        }
      />
      <StatCard
        title="Active leases"
        value={String(data.counts.activeLeases)}
        sub={`${data.counts.tenants} ${data.counts.tenants === 1 ? 'tenant' : 'tenants'}`}
      />
      <StatCard
        title="Overdue"
        value={String(data.counts.overdueBills)}
        sub={
          data.counts.overdueBills === 0
            ? 'all clear'
            : `${data.counts.houses} ${data.counts.houses === 1 ? 'house' : 'houses'} · ${data.counts.units} units`
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Overdue bills</CardTitle>
        <CardDescription>
          {totalCount === 0
            ? 'No overdue bills. Nice.'
            : `${totalCount} overdue · showing latest ${Math.min(items.length, 10)}`}
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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent bills</CardTitle>
        <CardDescription>
          {items.length === 0
            ? 'No bills generated yet.'
            : `Last ${items.length} ${items.length === 1 ? 'bill' : 'bills'} across all leases.`}
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
                {b.unitLabel} · {b.houseName}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {b.tenantName} · period {formatDate(b.periodStart)} – {formatDate(b.periodEnd)}
              </p>
            </div>
            <div className="text-right">
              <p className="font-semibold">{formatMoney(b.total, b.currency)}</p>
              <p
                className={`text-xs ${highlightDue ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {highlightDue ? 'due ' : ''}
                {formatDate(b.dueDate)} · <BillStatusLabel status={b.status} />
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BillStatusLabel({ status }: { status: BillStatus }) {
  return <span>{status.toLowerCase().replace('_', ' ')}</span>;
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing here yet</CardTitle>
        <CardDescription>
          Add a house, then a unit, then a lease — bills and the dashboard fill in from there.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link href="/houses/new" className="text-sm font-medium underline">
          Create your first house →
        </Link>
      </CardContent>
    </Card>
  );
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
