import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Ticket, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ReopenButton } from './reopen-button';
import { ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function MyTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await fetchTicket(id);
  if (!ticket) notFound();

  const reference = ticket.closedAt ?? ticket.resolvedAt;
  const canReopen =
    (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') &&
    reference != null &&
    Date.now() - new Date(reference).getTime() <= REOPEN_WINDOW_MS;

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-tickets">← Back to my tickets</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ticket.title}</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={ticket.status} /> · {ticket.category.toLowerCase()} · raised{' '}
              {formatDate(ticket.createdAt)}
            </p>
          </div>
          {canReopen && <ReopenButton ticketId={ticket.id} />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversation</CardTitle>
          <CardDescription>Threaded messages land in Phase 3.2.</CardDescription>
        </CardHeader>
      </Card>
    </main>
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}

async function fetchTicket(id: string): Promise<Ticket | null> {
  try {
    return await serverApi<Ticket>(`/v1/me/tickets/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
