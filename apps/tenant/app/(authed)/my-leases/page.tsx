import Link from 'next/link';

import type { Lease, LeaseStatus, Page } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'My leases' };

export default async function MyLeasesPage() {
  const page = await serverApi<Page<Lease>>('/v1/me/leases?limit=20');
  const grouped = groupByActiveFirst(page.items);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">My leases</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0 ? 'No leases yet.' : `${page.items.length} on record.`}
        </p>
      </header>

      {grouped.active.length > 0 && (
        <Section title="Current">
          {grouped.active.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} />
          ))}
        </Section>
      )}
      {grouped.draft.length > 0 && (
        <Section title="Draft (not yet active)">
          {grouped.draft.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title="History">
          {grouped.closed.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} />
          ))}
        </Section>
      )}

      {page.items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>
              When your landlord creates a lease for you, it will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

function LeaseCard({ lease }: { lease: Lease }) {
  return (
    <li>
      <Link
        href={`/my-leases/${lease.id}`}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">
              {formatMoney(lease.rentAmount, lease.currency)} / {lease.rentCycle.toLowerCase()}
            </p>
            <StatusBadge status={lease.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {formatDate(lease.startDate)} – {formatDate(lease.endDate)}
          </p>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: LeaseStatus }) {
  const palette: Record<LeaseStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ACTIVE: 'bg-emerald-100 text-emerald-900',
    ENDED: 'bg-zinc-200 text-zinc-700',
    TERMINATED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

function groupByActiveFirst(items: Lease[]): {
  active: Lease[];
  draft: Lease[];
  closed: Lease[];
} {
  const active: Lease[] = [];
  const draft: Lease[] = [];
  const closed: Lease[] = [];
  for (const l of items) {
    if (l.status === 'ACTIVE') active.push(l);
    else if (l.status === 'DRAFT') draft.push(l);
    else closed.push(l);
  }
  return { active, draft, closed };
}
