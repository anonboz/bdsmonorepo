import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';

import { getFormatters } from '@repo/i18n';
import type { Lease, LeaseRatingState, LeaseStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { RatingsCard } from './ratings-card';
import { ApiError } from '../../../../lib/api';
import { serverApi } from '../../../../lib/session';

export default async function MyLeaseDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  const lease = await fetchLease(leaseId);
  if (!lease) notFound();
  const ratingState = await fetchRatingState(leaseId);

  const t = await getTranslations('tenant.leases');
  const tDetail = await getTranslations('tenant.leases.detail');
  const tCycle = await getTranslations('tenant.statuses.rentCycles');
  const { formatDate, formatMoney } = getFormatters(await getLocale());

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-leases">{t('back')}</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{tDetail('title')}</h1>
        <p className="text-sm text-muted-foreground">
          <StatusBadge status={lease.status} /> · {formatDate(lease.startDate)} –{' '}
          {formatDate(lease.endDate)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{tDetail('moneyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Stat
              label={tDetail('rentLabel')}
              value={`${formatMoney(lease.rentAmount, lease.currency)} / ${tCycle(lease.rentCycle)}`}
            />
            <Stat
              label={tDetail('depositLabel')}
              value={formatMoney(lease.depositAmount, lease.currency)}
            />
          </dl>
        </CardContent>
      </Card>

      {lease.terminationReason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('terminationTitle')}</CardTitle>
            <CardDescription>{tDetail('terminationDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{lease.terminationReason}</p>
          </CardContent>
        </Card>
      )}

      {ratingState && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{tDetail('ratingsTitle')}</CardTitle>
            <CardDescription>{tDetail('ratingsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <RatingsCard
              state={ratingState}
              submitPath={`/v1/me/leases/${lease.id}/ratings`}
              counterpartyLabel="owner"
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

async function fetchRatingState(id: string): Promise<LeaseRatingState | null> {
  try {
    return await serverApi<LeaseRatingState>(`/v1/me/leases/${id}/rating-state`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: LeaseStatus }) {
  const t = useTranslations('tenant.statuses.leases');
  const palette: Record<LeaseStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ACTIVE: 'bg-emerald-100 text-emerald-900',
    ENDED: 'bg-zinc-200 text-zinc-700',
    TERMINATED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {t(status)}
    </span>
  );
}

async function fetchLease(id: string): Promise<Lease | null> {
  try {
    return await serverApi<Lease>(`/v1/me/leases/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
