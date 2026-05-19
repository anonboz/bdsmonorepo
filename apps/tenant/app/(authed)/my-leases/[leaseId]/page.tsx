import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Lease, LeaseStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { formatDate, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export default async function MyLeaseDetailPage({
  params,
}: {
  params: Promise<{ leaseId: string }>;
}) {
  const { leaseId } = await params;
  const lease = await fetchLease(leaseId);
  if (!lease) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-leases">← Back to my leases</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Lease details</h1>
        <p className="text-sm text-muted-foreground">
          <StatusBadge status={lease.status} /> · {formatDate(lease.startDate)} –{' '}
          {formatDate(lease.endDate)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Money</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Stat
              label="Rent"
              value={`${formatMoney(lease.rentAmount, lease.currency)} / ${lease.rentCycle.toLowerCase()}`}
            />
            <Stat label="Deposit" value={formatMoney(lease.depositAmount, lease.currency)} />
          </dl>
        </CardContent>
      </Card>

      {lease.terminationReason && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Termination reason</CardTitle>
            <CardDescription>Recorded by your landlord.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{lease.terminationReason}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Bills</CardTitle>
          <CardDescription>
            Bills land in Phase 2.3. You will see issued and paid bills here.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
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

async function fetchLease(id: string): Promise<Lease | null> {
  try {
    return await serverApi<Lease>(`/v1/me/leases/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
