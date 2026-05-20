import Link from 'next/link';

import type { JobStatus, Page, ServiceJob } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDateTime, formatMoney } from '../../../lib/format';
import { serverApi } from '../../../lib/session';

export const metadata = { title: 'Jobs' };

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

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0 ? 'No jobs yet.' : `${page.items.length} on record.`}
        </p>
      </header>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>
              Owners book you from the partner directory. Make sure your profile is published.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((j) => (
            <li key={j.id}>
              <Link
                href={`/jobs/${j.id}`}
                className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      {j.serviceName ?? 'Direct booking'} · {j.description ?? '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested {formatDateTime(j.createdAt)}
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
