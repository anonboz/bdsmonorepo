import Link from 'next/link';

import type { Page, Ticket, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'My tickets' };

export default async function MyTicketsPage() {
  const page = await serverApi<Page<Ticket>>('/v1/me/tickets?limit=20');
  const grouped = groupByOpenFirst(page.items);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My tickets</h1>
          <p className="text-sm text-muted-foreground">
            {page.items.length === 0 ? 'No tickets yet.' : `${page.items.length} on record.`}
          </p>
        </div>
        <Button asChild>
          <Link href="/my-tickets/new">New ticket</Link>
        </Button>
      </header>

      {grouped.open.length > 0 && (
        <Section title="Open">
          {grouped.open.map((t) => (
            <TicketCard key={t.id} ticket={t} />
          ))}
        </Section>
      )}
      {grouped.closed.length > 0 && (
        <Section title="History">
          {grouped.closed.map((t) => (
            <TicketCard key={t.id} ticket={t} />
          ))}
        </Section>
      )}

      {page.items.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>
              Raise a ticket if something needs attention in your unit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/my-tickets/new">Raise a ticket</Link>
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

function TicketCard({ ticket }: { ticket: Ticket }) {
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
            {ticket.category.toLowerCase()} · raised {formatDate(ticket.createdAt)}
          </p>
        </div>
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
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase().replace('_', ' ')}
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
