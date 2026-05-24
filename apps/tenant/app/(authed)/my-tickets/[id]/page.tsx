import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { Page, Ticket, TicketMessage, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ReopenButton } from './reopen-button';
import { TicketThread } from './ticket-thread';
import { ApiError } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';
import { getSession, serverApi } from '../../../../lib/session';

const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default async function MyTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [ticket, messages, session] = await Promise.all([
    fetchTicket(id),
    fetchMessages(id),
    getSession(),
  ]);
  if (!ticket || !session) notFound();

  const reference = ticket.closedAt ?? ticket.resolvedAt;
  const inReopenWindow =
    reference != null && Date.now() - new Date(reference).getTime() <= REOPEN_WINDOW_MS;
  const canReopen = (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') && inReopenWindow;
  const threadOpen = ticket.status !== 'CLOSED' || inReopenWindow;

  const t = await getTranslations('tenant.tickets');
  const tDetail = await getTranslations('tenant.tickets.detail');
  const tCat = await getTranslations('tenant.statuses.ticketCategories');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-tickets">{t('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ticket.title}</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={ticket.status} /> · {tCat(ticket.category)} ·{' '}
              {t('raisedAt', { date: formatDate(ticket.createdAt) })}
            </p>
          </div>
          {canReopen && <ReopenButton ticketId={ticket.id} />}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('detailsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('conversationTitle')}</CardTitle>
          <CardDescription>{tDetail('conversationDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <TicketThread
            ticketId={ticket.id}
            basePath="/v1/me/tickets"
            viewerRole="TENANT"
            viewerId={session.user.id}
            canPost={threadOpen}
            lockedReason={tDetail('lockedDefault')}
            initialItems={messages}
          />
        </CardContent>
      </Card>
    </main>
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
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

async function fetchMessages(id: string): Promise<TicketMessage[]> {
  try {
    const page = await serverApi<Page<TicketMessage>>(
      `/v1/me/tickets/${id}/messages?limit=100&sort=asc`,
    );
    return page.items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}
