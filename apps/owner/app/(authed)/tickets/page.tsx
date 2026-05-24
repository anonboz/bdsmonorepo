import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { Page, Ticket, TicketStatus } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('owner.tickets');
  return { title: t('metadataTitle') };
}

export default async function TicketsPage() {
  const page = await serverApi<Page<Ticket>>('/v1/me/owner-tickets?limit=50');
  const grouped = groupByActiveFirst(page.items);
  const t = await getTranslations('owner.tickets');

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0
            ? t('listEmpty')
            : t('listSummary', { open: grouped.open.length, closed: grouped.closed.length })}
        </p>
      </header>

      {grouped.open.length > 0 && (
        <Section title={t('sectionAttention')}>
          {grouped.open.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title={t('sectionClosed')}>
          {grouped.closed.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} />
          ))}
        </Section>
      )}

      {page.items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('emptyHint')}</p>
          </CardContent>
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
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const t = useTranslations('owner.tickets');
  const tCat = useTranslations('owner.statuses.ticketCategoriesLower');
  return (
    <li>
      <Link
        href={`/tickets/${ticket.id}`}
        className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{ticket.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {t('rowMeta', {
              category: tCat(ticket.category),
              reporter: ticket.reporterName,
              date: formatDate(ticket.createdAt),
            })}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations('owner.statuses.tickets');
  const palette: Record<TicketStatus, string> = {
    OPEN: 'bg-blue-100 text-blue-900',
    ACKNOWLEDGED: 'bg-sky-100 text-sky-900',
    IN_PROGRESS: 'bg-amber-100 text-amber-900',
    RESOLVED: 'bg-emerald-100 text-emerald-900',
    CLOSED: 'bg-zinc-200 text-zinc-700',
    REOPENED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span
      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}
    >
      {t(status)}
    </span>
  );
}

function groupByActiveFirst(items: Ticket[]): { open: Ticket[]; closed: Ticket[] } {
  const open: Ticket[] = [];
  const closed: Ticket[] = [];
  for (const t of items) {
    if (t.status === 'CLOSED') closed.push(t);
    else open.push(t);
  }
  return { open, closed };
}
