import Link from 'next/link';

import type { JobStatus, Page, ServiceJob } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

const PALETTE: Record<JobStatus, string> = {
  REQUESTED: 'bg-sky-100 text-sky-900',
  QUOTED: 'bg-indigo-100 text-indigo-900',
  ACCEPTED: 'bg-amber-100 text-amber-900',
  IN_PROGRESS: 'bg-orange-100 text-orange-900',
  COMPLETED: 'bg-emerald-100 text-emerald-900',
  RATED: 'bg-emerald-200 text-emerald-900',
  CANCELLED: 'bg-zinc-200 text-zinc-700',
};

/**
 * Lists partner jobs linked to this ticket and offers a CTA to request
 * a new one. Bookable tickets (OPEN/ACKNOWLEDGED/IN_PROGRESS/REOPENED)
 * get the button; RESOLVED/CLOSED tickets see a hint to reopen.
 */
export async function PartnerJobsCard({
  ticketId,
  bookable,
}: {
  ticketId: string;
  bookable: boolean;
}) {
  const page = await serverApi<Page<ServiceJob>>(
    `/v1/me/service-jobs?ticketId=${ticketId}&limit=20`,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">Partner jobs</CardTitle>
          <CardDescription>
            {page.items.length === 0
              ? 'No partner has been booked for this ticket yet.'
              : `${page.items.length} job${page.items.length === 1 ? '' : 's'} linked to this ticket.`}
          </CardDescription>
        </div>
        {bookable ? (
          <Button asChild size="sm">
            <Link href={`/partners?fromTicket=${ticketId}`}>Request a partner</Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Re-open the ticket to book.</p>
        )}
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/me/service-jobs/${j.id}`}
                  className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">{j.partnerBusinessName}</p>
                    <p className="text-xs text-muted-foreground">
                      Booked {formatDateTime(j.createdAt)}
                      {j.quotedAmount != null && j.currency
                        ? ` · ${formatMoney(j.quotedAmount, j.currency)}`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[j.status]}`}
                  >
                    {j.status.toLowerCase().replace('_', ' ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
