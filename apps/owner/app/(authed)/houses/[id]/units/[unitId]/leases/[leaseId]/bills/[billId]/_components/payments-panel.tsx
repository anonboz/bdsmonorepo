'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { BillStatus, Payment, RecordPaymentResponse } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Spinner,
  Textarea,
} from '@repo/ui';

import { ApiError, api } from '../../../../../../../../../../../lib/api';
import { formatDateTime, formatMoney } from '../../../../../../../../../../../lib/format';

const PAYABLE_STATES: BillStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

export function PaymentsPanel({
  houseId,
  unitId,
  leaseId,
  billId,
  billStatus,
  currency,
  remaining,
  initialPayments,
}: {
  houseId: string;
  unitId: string;
  leaseId: string;
  billId: string;
  billStatus: BillStatus;
  currency: string;
  /** Bill total minus succeeded payments, in minor units. */
  remaining: number;
  initialPayments: Payment[];
}) {
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [amount, setAmount] = useState<string>(String(remaining));
  const [providerRef, setProviderRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRecord = PAYABLE_STATES.includes(billStatus);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const amt = Number.parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Amount must be a positive integer (minor units).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: {
        amount: number;
        currency: string;
        providerRef?: string;
        note?: string;
      } = { amount: amt, currency };
      if (providerRef.trim()) body.providerRef = providerRef.trim();
      if (note.trim()) body.note = note.trim();
      const res = await api.post<RecordPaymentResponse>(
        `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${billId}/payments`,
        body,
      );
      setPayments((prev) => [...prev, res.payment]);
      setAmount(String(Math.max(0, remaining - res.payment.amount)));
      setProviderRef('');
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
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
            <table className="w-full text-sm">
              <thead className="border-y text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Received</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Ref</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(p.receivedAt ?? p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {formatMoney(p.amount, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.provider.toLowerCase()}</td>
                    <td className="px-4 py-3 text-xs">{p.providerRef ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{p.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>

      {canRecord && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Record payment</CardTitle>
            <CardDescription>
              Outstanding balance: {formatMoney(remaining, currency)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Could not record payment</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount (minor units, {currency})</Label>
                <Input
                  id="amount"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={remaining}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="providerRef">Reference (optional)</Label>
                <Input
                  id="providerRef"
                  placeholder="Bank transfer ref, cheque #…"
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="note">Note (optional)</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />}
                Record payment
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
