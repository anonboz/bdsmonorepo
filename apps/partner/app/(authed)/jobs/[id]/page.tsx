import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { JobStatus, ServiceJob } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { JobActions } from './job-actions';
import { ApiError } from '../../../../lib/api';
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

export default async function PartnerJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await fetchJob(id);
  if (!job) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/jobs">← Back to jobs</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{job.serviceName ?? 'Direct booking'}</h1>
        <p className="text-sm text-muted-foreground">
          <span
            className={`mr-1 rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[job.status]}`}
          >
            {job.status.toLowerCase().replace('_', ' ')}
          </span>
          · requested {formatDateTime(job.createdAt)}
          {job.quotedAmount != null && job.currency
            ? ` · quoted ${formatMoney(job.quotedAmount, job.currency)}`
            : ''}
        </p>
      </div>

      {job.cancelReason && (
        <div
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-rose-900"
          role="status"
        >
          <p className="text-sm font-semibold">Cancelled</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            Reason: {job.cancelReason}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Request</CardTitle>
          <CardDescription>From the owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {job.description ?? <em className="text-muted-foreground">No description provided.</em>}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <JobActions job={job} />
        </CardContent>
      </Card>

      {job.proofPhotos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Proof of work</CardTitle>
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
    </main>
  );
}

async function fetchJob(id: string): Promise<ServiceJob | null> {
  try {
    return await serverApi<ServiceJob>(`/v1/me/jobs/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
