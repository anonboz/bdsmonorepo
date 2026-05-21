import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Bill, BillStatus, Page, Payment } from '@repo/shared';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@repo/ui';

import { DownloadReceipt } from './_components/download-receipt';
import { PaymentsPanel } from './_components/payments-panel';
import { ApiError } from '../../../../../../../../../../lib/api';
import { formatDate, formatMoney } from '../../../../../../../../../../lib/format';
import { serverApi } from '../../../../../../../../../../lib/session';

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string; unitId: string; leaseId: string; billId: string }>;
}) {
  const { id: houseId, unitId, leaseId, billId } = await params;
  const bill = await fetchBill(houseId, unitId, leaseId, billId);
  if (!bill) notFound();
  const payments = await fetchPayments(houseId, unitId, leaseId, billId);
  const paid = payments.reduce((acc, p) => (p.status === 'SUCCEEDED' ? acc + p.amount : acc), 0);
  const remaining = Math.max(0, bill.total - paid);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href={`/houses/${houseId}/units/${unitId}/leases/${leaseId}`}>← Back to lease</Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{formatMoney(bill.total, bill.currency)}</h1>
            <p className="text-sm text-muted-foreground">
              <StatusBadge status={bill.status} /> · {formatDate(bill.periodStart)} –{' '}
              {formatDate(bill.periodEnd)} · due {formatDate(bill.dueDate)}
            </p>
          </div>
          <DownloadReceipt houseId={houseId} unitId={unitId} leaseId={leaseId} billId={bill.id} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line) => (
                <tr key={line.id} className="border-b last:border-0">
                  <td className="py-3">
                    <p className="font-medium">{line.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.kind.toLowerCase().replace(/_/g, ' ')}
                    </p>
                  </td>
                  <td className="py-3">{line.quantity}</td>
                  <td className="py-3 text-right font-medium">
                    {formatMoney(line.amount, bill.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2">
                <td className="py-3 font-semibold">Total</td>
                <td />
                <td className="py-3 text-right font-semibold">
                  {formatMoney(bill.total, bill.currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      <PaymentsPanel
        houseId={houseId}
        unitId={unitId}
        leaseId={leaseId}
        billId={bill.id}
        billStatus={bill.status}
        currency={bill.currency}
        remaining={remaining}
        initialPayments={payments}
      />
    </main>
  );
}

async function fetchPayments(
  houseId: string,
  unitId: string,
  leaseId: string,
  billId: string,
): Promise<Payment[]> {
  try {
    const page = await serverApi<Page<Payment>>(
      `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${billId}/payments`,
    );
    return page.items;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}

async function fetchBill(
  houseId: string,
  unitId: string,
  leaseId: string,
  billId: string,
): Promise<Bill | null> {
  try {
    return await serverApi<Bill>(
      `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${billId}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
