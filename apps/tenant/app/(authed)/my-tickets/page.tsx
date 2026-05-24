import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { Page, Ticket, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.tickets');
  return { title: t('metadataTitle') };
}

export default async function MyTicketsPage() {
  const page = await serverApi<Page<Ticket>>('/v1/me/tickets?limit=20');
  const grouped = groupByOpenFirst(page.items);
  const t = await getTranslations('tenant.tickets');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('summaryCount', { count: page.items.length })}
          </p>
        </div>
        <Button asChild>
          <Link href="/my-tickets/new">{t('newButton')}</Link>
        </Button>
      </header>

      {grouped.open.length > 0 && (
        <Section title={t('sectionOpen')}>
          {grouped.open.map((tk) => (
            <TicketCard key={tk.id} ticket={tk} fmt={fmt} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title={t('sectionHistory')}>
          {grouped.closed.map((tk) => (
            <TicketCard key={tk.id} ticket={tk} fmt={fmt} />
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
            <Button asChild>
              <Link href="/my-tickets/new">{t('emptyButton')}</Link>
            </Button>
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
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

function TicketCard({ ticket, fmt }: { ticket: Ticket; fmt: Formatters }) {
  const t = useTranslations('tenant.tickets');
  const tCat = useTranslations('tenant.statuses.ticketCategories');
  return (
    <li>
      <Link
        href={`/my-tickets/${ticket.id}`}
        className="block rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold leading-tight">{ticket.title}</p>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {tCat(ticket.category)} · {t('raisedAt', { date: fmt.formatDate(ticket.createdAt) })}
          </p>
        </div>
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
  const t = useTranslations('tenant.statuses.tickets');
  const palette: Record<TicketStatus, string> = {
    OPEN: 'bg-blue-100 text-blue-900',
    ACKNOWLEDGED: 'bg-sky-100 text-sky-900',
    IN_PROGRESS: 'bg-amber-100 text-amber-900',
    RESOLVED: 'bg-emerald-100 text-emerald-900',
    CLOSED: 'bg-zinc-200 text-zinc-700',
    REOPENED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
    </span>
  );
}

function groupByOpenFirst(items: Ticket[]): { open: Ticket[]; closed: Ticket[] } {
  const open: Ticket[] = [];
  const closed: Ticket[] = [];
  for (const t of items) {
    if (t.status === 'CLOSED') closed.push(t);
    else open.push(t);
  }
  return { open, closed };
}
