import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Lease, LeaseRatingState, LeaseStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { BillsCard } from './_components/bills-card';
import { RatingsCard } from './_components/ratings-card';
import { ApiError } from '../../../../../../../../lib/api';
import { formatDate, formatMoney } from '../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../lib/session';
import { LeaseTransitions } from '../_components/lease-transitions';

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; leaseId: string }>;
}) {
  const { id: houseId, unitId, leaseId } = await params;
  const lease = await fetchLease(houseId, unitId, leaseId);
  if (!lease) notFound();
  const ratingState = await fetchRatingState(houseId, unitId, leaseId);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}`}>← Back to unit</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Lease</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={lease.status} /> · started {formatDate(lease.startDate)}
              {lease.endDate && ` · ends ${formatDate(lease.endDate)}`}
            </p>
          </div>
          {lease.status === 'DRAFT' && (
            <Button asChild variant="outline">
              <Link href={`/houses/${houseId}/units/${unitId}/leases/${lease.id}/edit`}>Edit</Link>
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Money</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Stat
              label="Rent"
              value={`${formatMoney(lease.rentAmount, lease.currency)} / ${lease.rentCycle.toLowerCase()}`}
            />
            <Stat label="Deposit" value={formatMoney(lease.depositAmount, lease.currency)} />
            <Stat label="Currency" value={lease.currency} />
            <Stat label="Cycle" value={lease.rentCycle.toLowerCase()} />
          </dl>
        </CardContent>
      </Card>

      {lease.terminationReason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Termination reason</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{lease.terminationReason}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Actions</CardTitle>
          <CardDescription>
            {lease.status === 'DRAFT' &&
              'Activate to bind the tenant and flip the unit to occupied.'}
            {lease.status === 'ACTIVE' &&
              'End to release the unit cleanly, or terminate with a reason.'}
            {(lease.status === 'ENDED' || lease.status === 'TERMINATED') &&
              'This lease is closed. No further transitions are possible.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LeaseTransitions houseId={houseId} unitId={unitId} lease={lease} />
        </CardContent>
      </Card>

      <BillsCard houseId={houseId} unitId={unitId} leaseId={leaseId} leaseStatus={lease.status} />

      {ratingState && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Rate your tenant</CardTitle>
            <CardDescription>
              Quick 1–5 star rating at each lease milestone. Comments are optional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RatingsCard
              state={ratingState}
              submitPath={`/v1/houses/${houseId}/units/${unitId}/leases/${lease.id}/ratings`}
            />
          </CardContent>
        </Card>
      )}
    </main>
  );
}

async function fetchRatingState(
  houseId: string,
  unitId: string,
  leaseId: string,
): Promise<LeaseRatingState | null> {
  try {
    return await serverApi<LeaseRatingState>(
      `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/rating-state`,
    );
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
  const palette: Record<LeaseStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ACTIVE: 'bg-emerald-100 text-emerald-900',
    ENDED: 'bg-zinc-200 text-zinc-700',
    TERMINATED: 'bg-rose-100 text-rose-900',
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase()}
    </span>
  );
}

async function fetchLease(houseId: string, unitId: string, leaseId: string): Promise<Lease | null> {
  try {
    return await serverApi<Lease>(`/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
