import Link from 'next/link';

import type { Bill, BillStatus, Page } from '@repo/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { GenerateNowButton } from './generate-now-button';
import { formatDate, formatMoney } from '../../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../../lib/session';

export async function BillsCard({
  houseId,
  unitId,
  leaseId,
  leaseStatus,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  leaseStatus: string;
}) {
  const page = await serverApi<Page<Bill>>(
    `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills?limit=20`,
  );
  const isActive = leaseStatus === 'ACTIVE';

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-lg">Bills</CardTitle>
          <CardDescription>
            {page.items.length === 0
              ? isActive
                ? 'No bills yet. Generate one to issue rent.'
                : 'No bills yet. Activate the lease to enable billing.'
              : `${page.items.length} ${page.items.length === 1 ? 'bill' : 'bills'} on record.`}
          </CardDescription>
        </div>
        {isActive && <GenerateNowButton houseId={houseId} unitId={unitId} leaseId={leaseId} />}
      </CardHeader>
      {page.items.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {page.items.map((bill) => (
              <BillRow
                key={bill.id}
                houseId={houseId}
                unitId={unitId}
                leaseId={leaseId}
                bill={bill}
              />
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

function BillRow({
  houseId,
  unitId,
  leaseId,
  bill,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  bill: Bill;
}) {
  return (
    <li>
      <Link
        href={`/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${bill.id}`}
        className="flex items-center justify-between rounded-md border p-3 text-sm transition-colors hover:border-foreground/20"
      >
        <div className="space-y-0.5">
          <p className="font-medium">{formatMoney(bill.total, bill.currency)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(bill.periodStart)} – {formatDate(bill.periodEnd)} · due{' '}
            {formatDate(bill.dueDate)}
          </p>
        </div>
        <StatusBadge status={bill.status} />
      </Link>
    </li>
  );
}

function StatusBadge({ status }: { status: BillStatus }) {
  const palette: Record<BillStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-700',
    ISSUED: 'bg-blue-100 text-blue-900',
    PARTIALLY_PAID: 'bg-amber-100 text-amber-900',
    PAID: 'bg-emerald-100 text-emerald-900',
    OVERDUE: 'bg-rose-100 text-rose-900',
    VOID: 'bg-zinc-200 text-zinc-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}
