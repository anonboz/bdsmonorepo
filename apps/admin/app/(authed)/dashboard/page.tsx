import Link from 'next/link';

import { getFormatters } from '@repo/i18n';
import type { MoneyByCurrency, PlatformDashboard } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const fmt = getFormatters('en');
  const snap = await serverApi<PlatformDashboard>('/v1/admin/dashboard');

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Platform dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Snapshot generated {fmt.formatDateTime(snap.generatedAt)}. No FX — totals per currency.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Refresh</Link>
        </Button>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Users" subtitle="excludes soft-deleted">
          <Stat label="Total" value={snap.users.total.toLocaleString()} />
          <Stat label="Suspended" value={snap.users.suspended.toLocaleString()} />
          <Stat label="KYC pending" value={snap.users.pendingKyc.toLocaleString()} />
          <Stat
            label="Active 7d / 30d"
            value={`${snap.users.activeIn7d} / ${snap.users.activeIn30d}`}
          />
        </KpiCard>

        <KpiCard title="Houses" subtitle="listings + moderation">
          <Stat label="Total" value={snap.houses.total.toLocaleString()} />
          <Stat label="Published" value={snap.houses.published.toLocaleString()} />
          <Stat
            label="Flagged"
            value={snap.houses.flagged.toLocaleString()}
            highlight={snap.houses.flagged > 0 ? 'amber' : undefined}
          />
          <Stat label="Rejected" value={snap.houses.rejected.toLocaleString()} />
        </KpiCard>

        <KpiCard title="Leases" subtitle="active / draft">
          <Stat label="Active" value={snap.leases.active.toLocaleString()} />
          <Stat label="Draft" value={snap.leases.draft.toLocaleString()} />
        </KpiCard>

        <KpiCard title="Tickets" subtitle="open queue + SLA">
          <Stat
            label="Open"
            value={snap.tickets.openCount.toLocaleString()}
            highlight={snap.tickets.openCount > 0 ? 'amber' : undefined}
          />
          <Stat label="Resolved 7d" value={snap.tickets.resolvedLast7d.toLocaleString()} />
          <Stat
            label="Median time-to-resolve (30d)"
            value={
              snap.tickets.medianResolveMs == null
                ? '—'
                : formatDuration(snap.tickets.medianResolveMs)
            }
          />
        </KpiCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">GMV — all time</CardTitle>
            <CardDescription>Sum of paid bills, per currency.</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyList items={snap.gmvAllTime} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">GMV — last 30 days</CardTitle>
            <CardDescription>Bills updated in the trailing 30 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyList items={snap.gmvLast30d} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Overdue</CardTitle>
          <CardDescription>
            {snap.overdue.count} bill{snap.overdue.count === 1 ? '' : 's'} past due (ISSUED /
            PARTIALLY_PAID / OVERDUE).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MoneyList items={snap.overdue.byCurrency} />
        </CardContent>
      </Card>
    </main>
  );
}

function KpiCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1.5">{children}</CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: 'amber' | 'rose';
}) {
  const palette =
    highlight === 'amber'
      ? 'text-amber-700'
      : highlight === 'rose'
        ? 'text-rose-700'
        : 'text-foreground';
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-semibold tabular-nums ${palette}`}>{value}</dd>
    </div>
  );
}

function MoneyList({ items }: { items: MoneyByCurrency[] }) {
  const fmt = getFormatters('en');
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No data.</p>;
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((m) => (
        <li key={m.currency} className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">{m.currency}</span>
          <span className="font-semibold tabular-nums">
            {fmt.formatMoney(m.amount, m.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
