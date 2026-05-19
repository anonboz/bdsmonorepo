import Link from 'next/link';

import type { Page, Ticket, TicketStatus } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Tickets' };

export default async function TicketsPage() {
  const page = await serverApi<Page<Ticket>>('/v1/me/owner-tickets?limit=50');
  const grouped = groupByActiveFirst(page.items);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0
            ? 'No tickets across your properties yet.'
            : `${grouped.open.length} need attention · ${grouped.closed.length} closed.`}
        </p>
      </header>

      {grouped.open.length > 0 && (
        <Section title="Needs attention">
          {grouped.open.map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title="Resolved / closed">
          {grouped.closed.map((t) => (
            <TicketRow key={t.id} ticket={t} />
          ))}
        </Section>
      )}

      {page.items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No tickets yet</CardTitle>
            <CardDescription>
              When a tenant raises a repair or report, it appears here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Nothing to do right now.</p>
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
  return (
    <li>
      <Link
        href={`/tickets/${ticket.id}`}
        className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{ticket.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {ticket.category.toLowerCase()} · {ticket.reporterName} · raised{' '}
            {formatDate(ticket.createdAt)}
          </p>
        </div>
        <StatusBadge status={ticket.status} />
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: TicketStatus }) {
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
      {status.toLowerCase().replace('_', ' ')}
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
