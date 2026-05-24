import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { type Formatters, getFormatters } from '@repo/i18n';
import type { LeaseRating, Page, UserRatingSummary } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { serverApi } from '../../../../lib/session';

export async function generateMetadata() {
  const t = await getTranslations('tenant.ratings');
  return { title: t('metadataTitle') };
}

export default async function MyRatingsPage() {
  const [page, summary] = await Promise.all([
    serverApi<Page<LeaseRating>>('/v1/me/ratings?limit=20'),
    serverApi<UserRatingSummary>('/v1/me/ratings/summary'),
  ]);
  const t = await getTranslations('tenant.ratings');
  const fmt = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('reputationTitle')}</CardTitle>
          <CardDescription>
            {summary.count === 0 ? t('noRatings') : t('ratingsCount', { count: summary.count })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold">
            {summary.average === null ? '—' : summary.average.toFixed(1)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{t('perFive')}</span>
          </p>
        </CardContent>
      </Card>

      {page.items.length > 0 && (
        <ul className="space-y-3">
          {page.items.map((r) => (
            <RatingRow key={r.id} rating={r} fmt={fmt} />
          ))}
        </ul>
      )}
    </main>
  );
}

function RatingRow({ rating, fmt }: { rating: LeaseRating; fmt: Formatters }) {
  const t = useTranslations('tenant.ratings');
  const tMilestone = useTranslations('tenant.ratings.milestones');
  return (
    <li className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {t('fromLabel', { milestone: tMilestone(rating.milestone), name: rating.raterName })}
          </p>
          <p className="text-xs text-muted-foreground">{fmt.formatDate(rating.createdAt)}</p>
        </div>
        <Stars score={rating.score} />
      </div>
      {rating.comment && (
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{rating.comment}</p>
      )}
    </li>
  );
}

function Stars({ score }: { score: number }) {
  const t = useTranslations('tenant.ratings');
  return (
    <span className="text-amber-500" aria-label={t('scoreAria', { score })}>
      {'★'.repeat(score)}
      <span className="text-muted-foreground">{'★'.repeat(5 - score)}</span>
    </span>
  );
}
