import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

import type { JobRatingsForJob, JobStatus, ServiceJob } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { OwnerJobActions } from './owner-job-actions';
import { OwnerRatingPanel } from './owner-rating-panel';
import { ApiError } from '../../../../../lib/api';
import { formatDateTime, formatMoney } from '../../../../../lib/format';
import { serverApi } from '../../../../../lib/session';

const PALETTE: Record<JobStatus, string> = {
  REQUESTED: 'bg-sky-100 text-sky-900',
  QUOTED: 'bg-indigo-100 text-indigo-900',
  ACCEPTED: 'bg-amber-100 text-amber-900',
  IN_PROGRESS: 'bg-orange-100 text-orange-900',
  COMPLETED: 'bg-emerald-100 text-emerald-900',
  RATED: 'bg-emerald-200 text-emerald-900',
  CANCELLED: 'bg-zinc-200 text-zinc-700',
};

export default async function MyServiceJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) notFound();
  const ratings = job.status === 'COMPLETED' ? await fetchRatings(id) : null;

  const t = await getTranslations('owner.serviceJobs');
  const tDetail = await getTranslations('owner.serviceJobs.detail');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/me/service-jobs">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{job.partnerBusinessName}</h1>
        <SubtitleLine job={job} />
      </div>

      {job.cancelReason && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          role="status"
        >
          <p className="text-sm font-semibold">{tDetail('cancelledTitle')}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {tDetail('cancelledReason', { reason: job.cancelReason })}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('requestTitle')}</CardTitle>
          <CardDescription>{tDetail('requestSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RequestBody description={job.description ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('actionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <OwnerJobActions job={job} />
        </CardContent>
      </Card>

      {job.proofPhotos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('proofTitle')}</CardTitle>
            <CardDescription>{tDetail('proofSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {job.proofPhotos.map((url) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img key={url} src={url} alt="" className="aspect-video rounded-md object-cover" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {ratings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('ratingTitle')}</CardTitle>
            <CardDescription>{tDetail('ratingSubtitle')}</CardDescription>
          </CardHeader>
          <CardContent>
            <OwnerRatingPanel jobId={job.id} initial={ratings} />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function SubtitleLine({ job }: { job: ServiceJob }) {
  const tStatus = useTranslations('owner.statuses.jobs');
  const tDetail = useTranslations('owner.serviceJobs.detail');
  return (
    <p className="text-sm text-muted-foreground">
      <span className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[job.status]}`}>
        {tStatus(job.status)}
      </span>
      · {tDetail('subtitleRequested', { date: formatDateTime(job.createdAt) })}
      {job.quotedAmount != null && job.currency
        ? tDetail('subtitleQuoted', { amount: formatMoney(job.quotedAmount, job.currency) })
        : ''}
      {job.status === 'COMPLETED' && job.finalAmount != null && job.currency
        ? tDetail('subtitleFinal', { amount: formatMoney(job.finalAmount, job.currency) })
        : ''}
    </p>
  );
}

function RequestBody({ description }: { description: string | null }) {
  const t = useTranslations('owner.serviceJobs.detail');
  if (description) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{description}</p>;
  }
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      <em className="text-muted-foreground">{t('noDescription')}</em>
    </p>
  );
}

async function fetchJob(id: string): Promise<ServiceJob | null> {
  try {
    return await serverApi<ServiceJob>(`/v1/me/service-jobs/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

async function fetchRatings(id: string): Promise<JobRatingsForJob | null> {
  try {
    return await serverApi<JobRatingsForJob>(`/v1/me/service-jobs/${id}/ratings`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
