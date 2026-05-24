import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { JobStatus, Page, ServiceJob } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

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
  const t = await getTranslations('owner.tickets.partnerJobs');
  const fmt = getFormatters(await getLocale());

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>
            {page.items.length === 0 ? t('empty') : t('count', { count: page.items.length })}
          </CardDescription>
        </div>
        {bookable ? (
          <Button asChild size="sm">
            <Link href={`/partners?fromTicket=${ticketId}`}>{t('requestButton')}</Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('reopenHint')}</p>
        )}
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((j) => (
              <JobRow key={j.id} job={j} fmt={fmt} />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function JobRow({ job, fmt }: { job: ServiceJob; fmt: Formatters }) {
  const t = useTranslations('owner.tickets.partnerJobs');
  const tStatus = useTranslations('owner.statuses.jobs');
  return (
    <li>
      <Link
        href={`/me/service-jobs/${job.id}`}
        className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">{job.partnerBusinessName}</p>
          <p className="text-xs text-muted-foreground">
            {t('bookedAt', { date: fmt.formatDateTime(job.createdAt) })}
            {job.quotedAmount != null && job.currency
              ? ` · ${fmt.formatMoney(job.quotedAmount, job.currency)}`
              : ''}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[job.status]}`}>
          {tStatus(job.status)}
        </span>
      </Link>
    </li>
  );
}
