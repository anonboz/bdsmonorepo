import Link from 'next/link';

import type { Application, ApplicationStatus, Page } from '@repo/shared';
import { Button, Card, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export const metadata = { title: 'My applications' };

const PALETTE: Record<ApplicationStatus, string> = {
  SUBMITTED: 'bg-sky-100 text-sky-900',
  REVIEWING: 'bg-amber-100 text-amber-900',
  ACCEPTED: 'bg-emerald-100 text-emerald-900',
  REJECTED: 'bg-rose-100 text-rose-900',
  WITHDRAWN: 'bg-zinc-200 text-zinc-700',
};

export default async function MyApplicationsPage() {
  const page = await serverApi<Page<Application>>('/v1/me/applications?limit=20');

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">My applications</h1>
        <p className="text-sm text-muted-foreground">
          {page.items.length === 0 ? 'No applications yet.' : `${page.items.length} on record.`}
        </p>
      </div>

      {page.items.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing here yet</CardTitle>
            <CardDescription>
              <Link href="/browse" className="underline">
                Browse listings
              </Link>{' '}
              to find a place worth applying to.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3">
          {page.items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/me/applications/${a.id}`}
                className="block rounded-lg border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-semibold">Campaign · {a.campaignId.slice(-8)}</p>
                    <p className="text-xs text-muted-foreground">
                      Submitted {formatDate(a.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${PALETTE[a.status]}`}
                  >
                    {a.status.toLowerCase()}
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
