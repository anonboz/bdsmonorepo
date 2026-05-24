import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Bill, BillStatus, Page } from '@repo/shared';
import { Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.bills');
  return { title: t('metadataTitle') };
}

export default async function MyBillsPage() {
  const page = await serverApi<Page<Bill>>('/v1/me/bills?limit=20');
  const grouped = groupByOpenFirst(page.items);
  const t = await getTranslations('tenant.bills');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('summaryCount', { count: page.items.length })}
        </p>
      </header>

      {grouped.open.length > 0 && (
        <Section title={t('sectionOpen')}>
          {grouped.open.map((bill) => (
            <BillCard key={bill.id} bill={bill} fmt={fmt} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title={t('sectionHistory')}>
          {grouped.closed.map((bill) => (
            <BillCard key={bill.id} bill={bill} fmt={fmt} />
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

function BillCard({ bill, fmt }: { bill: Bill; fmt: Formatters }) {
  const t = useTranslations('tenant.bills');
  return (
    <li>
      <Link
        href={`/my-bills/${bill.id}`}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{fmt.formatMoney(bill.total, bill.currency)}</p>
            <StatusBadge status={bill.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmt.formatDate(bill.periodStart)} – {fmt.formatDate(bill.periodEnd)} ·{' '}
            {t('due', { date: fmt.formatDate(bill.dueDate) })}
          </p>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const t = useTranslations('tenant.statuses.bills');
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

function groupByOpenFirst(items: Bill[]): { open: Bill[]; closed: Bill[] } {
  const open: Bill[] = [];
  const closed: Bill[] = [];
  for (const b of items) {
    if (b.status === 'PAID' || b.status === 'VOID') closed.push(b);
    else open.push(b);
  }
  return { open, closed };
}
