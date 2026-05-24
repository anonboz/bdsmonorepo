import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Lease, LeaseStatus, Page } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.leases');
  return { title: t('metadataTitle') };
}

export default async function MyLeasesPage() {
  const page = await serverApi<Page<Lease>>('/v1/me/leases?limit=20');
  const grouped = groupByActiveFirst(page.items);
  const t = await getTranslations('tenant.leases');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('summaryCount', { count: page.items.length })}
        </p>
      </header>

      {grouped.active.length > 0 && (
        <Section title={t('sectionCurrent')}>
          {grouped.active.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} fmt={fmt} />
          ))}
        </Section>
      )}
      {grouped.draft.length > 0 && (
        <Section title={t('sectionDraft')}>
          {grouped.draft.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} fmt={fmt} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title={t('sectionHistory')}>
          {grouped.closed.map((lease) => (
            <LeaseCard key={lease.id} lease={lease} fmt={fmt} />
          ))}
        </Section>
      )}

      {page.items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
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

function LeaseCard({ lease, fmt }: { lease: Lease; fmt: Formatters }) {
  const t = useTranslations('tenant.leases');
  const tCycle = useTranslations('tenant.statuses.rentCycles');
  return (
    <li>
      <Link
        href={`/my-leases/${lease.id}`}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">
              {t('rentPerCycle', {
                amount: fmt.formatMoney(lease.rentAmount, lease.currency),
                cycle: tCycle(lease.rentCycle),
              })}
            </p>
            <StatusBadge status={lease.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmt.formatDate(lease.startDate)} – {fmt.formatDate(lease.endDate)}
          </p>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: LeaseStatus }) {
  const t = useTranslations('tenant.statuses.leases');
  const palette: Record<LeaseStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    AWAITING_SIGNATURES: 'bg-amber-100 text-amber-900',
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

function groupByActiveFirst(items: Lease[]): {
  active: Lease[];
  draft: Lease[];
  closed: Lease[];
} {
  const active: Lease[] = [];
  const draft: Lease[] = [];
  const closed: Lease[] = [];
  for (const l of items) {
    // Phase 12.3 — AWAITING_SIGNATURES lands in the draft section
    // visually; it's a "not yet active" state from the tenant's POV.
    if (l.status === 'ACTIVE') active.push(l);
    else if (l.status === 'DRAFT' || l.status === 'AWAITING_SIGNATURES') draft.push(l);
    else closed.push(l);
  }
  return { active, draft, closed };
}
