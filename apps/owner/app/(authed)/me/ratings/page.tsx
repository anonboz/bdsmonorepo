import Link from 'next/link';

import type { LeaseRating, Page, UserRatingSummary } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { formatDate } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export const metadata = { title: 'My ratings' };

export default async function MyRatingsPage() {
  const [page, summary] = await Promise.all([
    serverApi<Page<LeaseRating>>('/v1/me/ratings?limit=20'),
    serverApi<UserRatingSummary>('/v1/me/ratings/summary'),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">← Back</Link>
        </Button>
        <h1 className="text-2xl font-semibold">My ratings</h1>
        <p className="text-sm text-muted-foreground">What your tenants have said about you.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Reputation</CardTitle>
          <CardDescription>
            {summary.count === 0
              ? 'No ratings yet — your reputation will appear here as tenants rate you.'
              : `${summary.count} rating${summary.count === 1 ? '' : 's'} on record.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            {summary.average === null ? '—' : summary.average.toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/ 5</span>
          </p>
        </CardContent>
      </Card>

      {page.items.length > 0 && (
        <ul className="space-y-3">
          {page.items.map((r) => (
            <RatingRow key={r.id} rating={r} />
          ))}
        </ul>
      )}
    </main>
  );
}

function RatingRow({ rating }: { rating: LeaseRating }) {
  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {milestoneLabel(rating.milestone)} · from {rating.raterName}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(rating.createdAt)}</p>
        </div>
        <Stars score={rating.score} />
      </div>
      {rating.comment && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{rating.comment}</p>
      )}
    </li>
  );
}

function milestoneLabel(m: LeaseRating['milestone']): string {
  switch (m) {
    case 'MOVE_IN':
      return 'Move-in';
    case 'MID_LEASE':
      return 'Mid-lease';
    case 'MOVE_OUT':
      return 'Move-out';
  }
}

function Stars({ score }: { score: number }) {
  return (
    <span className="text-amber-500" aria-label={`${score} of 5`}>
      {'★'.repeat(score)}
      <span className="text-muted-foreground">{'★'.repeat(5 - score)}</span>
    </span>
  );
}
