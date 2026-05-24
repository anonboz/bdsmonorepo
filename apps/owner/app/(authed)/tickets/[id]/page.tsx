import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { getFormatters } from '@repo/i18n';
import type { Page, Ticket, TicketMessage, TicketStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { PartnerJobsCard } from './partner-jobs-card';
import { TicketThread } from './ticket-thread';
import { TicketTransitions } from './ticket-transitions';
import { ApiError } from '../../../../lib/api';
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

  const t = await getTranslations('owner.tickets');
  const tDetail = await getTranslations('owner.tickets.detail');
  const { formatDate } = getFormatters(await getLocale());
  const createdAtFormatted = formatDate(ticket.createdAt);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/tickets">{t('back')}</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ticket.title}</h1>
            <SubtitleLine ticket={ticket} createdAtFormatted={createdAtFormatted} />
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('detailsTitle')}</CardTitle>
          <CardDescription>
            <Link
              href={`/houses/${ticket.houseId}/units/${ticket.unitId}/leases/${ticket.leaseId}`}
              className="underline"
            >
              {tDetail('viewLease')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.body}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('actionsTitle')}</CardTitle>
          <CardDescription>
            <ActionsCopy status={ticket.status} />
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
          <CardTitle className="text-lg">{tDetail('conversationTitle')}</CardTitle>
          <CardDescription>
            {tDetail('conversationDescription', { reporter: ticket.reporterName })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TicketThread
            ticketId={ticket.id}
            basePath="/v1/me/owner-tickets"
            viewerRole="OWNER"
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

function SubtitleLine({
  ticket,
  createdAtFormatted,
}: {
  ticket: Ticket;
  createdAtFormatted: string;
}) {
  const t = useTranslations('owner.tickets.detail');
  const tCat = useTranslations('owner.statuses.ticketCategoriesLower');
  return (
    <p className="text-sm text-muted-foreground">
      <StatusBadge status={ticket.status} /> ·{' '}
      {t('subtitle', {
        category: tCat(ticket.category),
        reporter: ticket.reporterName,
        date: createdAtFormatted,
      })}
    </p>
  );
}

function ActionsCopy({ status }: { status: TicketStatus }) {
  const t = useTranslations('owner.tickets.detail');
  switch (status) {
    case 'OPEN':
      return <>{t('actionsCopyOpen')}</>;
    case 'ACKNOWLEDGED':
      return <>{t('actionsCopyAcknowledged')}</>;
    case 'IN_PROGRESS':
      return <>{t('actionsCopyInProgress')}</>;
    case 'RESOLVED':
      return <>{t('actionsCopyResolved')}</>;
    case 'CLOSED':
      return <>{t('actionsCopyClosed')}</>;
    case 'REOPENED':
      return <>{t('actionsCopyReopened')}</>;
  }
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
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
