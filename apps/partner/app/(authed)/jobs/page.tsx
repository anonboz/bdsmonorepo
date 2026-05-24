import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { JobStatus, Page, ServiceJob } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('partner.jobs');
  return { title: t('metadataTitle') };
}

const PALETTE: Record<JobStatus, string> = {
  REQUESTED: 'bg-sky-100 text-sky-900',
  QUOTED: 'bg-indigo-100 text-indigo-900',
  ACCEPTED: 'bg-amber-100 text-amber-900',
  IN_PROGRESS: 'bg-orange-100 text-orange-900',
  COMPLETED: 'bg-emerald-100 text-emerald-900',
  RATED: 'bg-emerald-200 text-emerald-900',
  CANCELLED: 'bg-zinc-200 text-zinc-700',
};

export default async function JobsPage() {
  const page = await serverApi<Page<ServiceJob>>('/v1/me/jobs?limit=20');
  const t = await getTranslations('partner.jobs');
  const tChrome = await getTranslations('partner.chrome');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{tChrome('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('listTitle')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('summaryCount', { count: page.items.length })}
        </p>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('emptyTitle')}</CardTitle>
            <CardDescription>{t('emptyDescription')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((j) => (
            <JobRow key={j.id} job={j} />
          ))}
        </ul>
      )}
    </main>
  );
}

function JobRow({ job }: { job: ServiceJob }) {
  const t = useTranslations('partner.jobs');
  const tStatus = useTranslations('partner.statuses.jobs');
  return (
    <li>
      <Link
        href={`/jobs/${job.id}`}
        className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <p className="font-semibold">
              {job.serviceName ?? t('directBooking')} · {job.description ?? t('noDescriptionDash')}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('requestedAt', { date: formatDateTime(job.createdAt) })}
              {job.quotedAmount != null && job.currency
                ? ` · ${formatMoney(job.quotedAmount, job.currency)}`
                : ''}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[job.status]}`}>
            {tStatus(job.status)}
          </span>
        </div>
      </Link>
    </li>
  );
}
