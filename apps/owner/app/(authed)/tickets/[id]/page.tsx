import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Page, Ticket, TicketMessage, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { PartnerJobsCard } from './partner-jobs-card';
import { TicketThread } from './ticket-thread';
import { TicketTransitions } from './ticket-transitions';
import { ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';
import { getSession, serverApi } from '../../../../lib/session';

const POST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function OwnerTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [ticket, messages, session] = await Promise.all([
    fetchTicket(id),
    fetchMessages(id),
    getSession(),
  ]);
  if (!ticket || !session) notFound();

  const reference = ticket.closedAt ?? ticket.resolvedAt;
  const threadOpen =
    ticket.status !== 'CLOSED' ||
    (reference != null && Date.now() - new Date(reference).getTime() <= POST_WINDOW_MS);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/tickets">← Back to tickets</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ticket.title}</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={ticket.status} /> · {ticket.category.toLowerCase()} · from{' '}
              {ticket.reporterName} · {formatDate(ticket.createdAt)}
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Details</CardTitle>
          <CardDescription>
            <Link
              href={`/houses/${ticket.houseId}/units/${ticket.unitId}/leases/${ticket.leaseId}`}
              className="underline"
            >
              View lease
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
          <CardDescription>
            {ticket.status === 'OPEN' && 'Acknowledge to let the tenant know it’s on your list.'}
            {ticket.status === 'ACKNOWLEDGED' &&
              'Move to In Progress when you start working on it.'}
            {ticket.status === 'IN_PROGRESS' && 'Resolve when the fix is in place.'}
            {ticket.status === 'RESOLVED' &&
              'Close once the tenant has had time to confirm (within 7 days they can reopen).'}
            {ticket.status === 'CLOSED' && 'Closed. The tenant has 7 days from closure to reopen.'}
            {ticket.status === 'REOPENED' && 'Tenant reopened — start a fresh cycle.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketTransitions ticketId={ticket.id} currentStatus={ticket.status} />
        </CardContent>
      </Card>

      <PartnerJobsCard
        ticketId={ticket.id}
        bookable={ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED'}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Conversation</CardTitle>
          <CardDescription>
            Messages with {ticket.reporterName}. Stays open for 7 days after closure.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketThread
            ticketId={ticket.id}
            basePath="/v1/me/owner-tickets"
            viewerRole="OWNER"
            viewerId={session.user.id}
            canPost={threadOpen}
            lockedReason="This ticket is closed and past the 7-day reopen window."
            initialItems={messages}
          />
        </CardContent>
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
    return await serverApi<Ticket>(`/v1/me/owner-tickets/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchMessages(id: string): Promise<TicketMessage[]> {
  try {
    const page = await serverApi<Page<TicketMessage>>(
      `/v1/me/owner-tickets/${id}/messages?limit=100&sort=asc`,
    );
    return page.items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}
