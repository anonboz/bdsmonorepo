import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Bill, BillStatus } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { formatDate, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';

export default async function MyBillDetailPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const bill = await fetchBill(billId);
  if (!bill) notFound();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <div className="space-y-1">
        <Button asChild variant="link" className="-mx-3 h-auto px-3 text-muted-foreground">
          <Link href="/my-bills">← Back to my bills</Link>
        </Button>
        <h1 className="text-2xl font-semibold">{formatMoney(bill.total, bill.currency)}</h1>
        <p className="text-sm text-muted-foreground">
          <StatusBadge status={bill.status} /> · for {formatDate(bill.periodStart)} –{' '}
          {formatDate(bill.periodEnd)} · due {formatDate(bill.dueDate)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {bill.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-4 py-3">
                <div>
                  <p className="font-medium">{line.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {line.kind.toLowerCase().replace(/_/g, ' ')}
                    {line.quantity > 1 ? ` · qty ${line.quantity}` : ''}
                  </p>
                </div>
                <p className="font-medium">{formatMoney(line.amount, bill.currency)}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pay</CardTitle>
          <CardDescription>
            Online payments land in Phase 2.5. For now, settle directly with your landlord.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
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
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${palette[status]}`}>
      {status.toLowerCase().replace('_', ' ')}
    </span>
  );
}

async function fetchBill(id: string): Promise<Bill | null> {
  try {
    return await serverApi<Bill>(`/v1/me/bills/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
