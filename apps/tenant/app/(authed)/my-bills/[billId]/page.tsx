import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { Bill, BillStatus, Page, Payment } from '@repo/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui';

import { ApiError } from '../../../../lib/api';
import { formatDate, formatDateTime, formatMoney } from '../../../../lib/format';
import { serverApi } from '../../../../lib/session';
import { DownloadReceipt } from '../_components/download-receipt';
import { PayOnline } from './_components/pay-online';

export default async function MyBillDetailPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const bill = await fetchBill(billId);
  if (!bill) notFound();
  const payments = await fetchPayments(billId);

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
          <CardTitle className="text-lg">Payments</CardTitle>
          <CardDescription>
            {payments.length === 0
              ? 'No payments recorded yet.'
              : `${payments.length} payment${payments.length === 1 ? '' : 's'} on file.`}
          </CardDescription>
        </CardHeader>
        {payments.length > 0 && (
          <CardContent className="p-0">
            <ul className="divide-y text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-medium">{formatMoney(p.amount, p.currency)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.provider.toLowerCase()}
                      {p.providerRef ? ` · ${p.providerRef}` : ''} ·{' '}
                      {formatDateTime(p.receivedAt ?? p.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Receipt</CardTitle>
          <CardDescription>Download a PDF copy for your records.</CardDescription>
        </CardHeader>
        <CardContent>
          <DownloadReceipt billId={bill.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pay online</CardTitle>
          <CardDescription>
            Pay this bill with a card via Stripe Checkout. Your bill flips to PAID once Stripe
            confirms — usually a few seconds after you finish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PayOnline billId={bill.id} billStatus={bill.status} />
        </CardContent>
      </Card>
    </main>
  );
}

async function fetchPayments(billId: string): Promise<Payment[]> {
  try {
    const page = await serverApi<Page<Payment>>(`/v1/me/bills/${billId}/payments`);
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

async function fetchBill(id: string): Promise<Bill | null> {
  try {
    return await serverApi<Bill>(`/v1/me/bills/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
