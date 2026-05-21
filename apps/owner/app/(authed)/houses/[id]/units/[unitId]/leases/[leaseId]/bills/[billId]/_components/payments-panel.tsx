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

  // Refund-dialog state: which Payment row is being refunded.
  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

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

  /**
   * Refundable balance for a charge row = `original.amount - sum(refunds against it)`.
   * The local `payments` list shows everything we know; treat it as the source of
   * truth for the dialog's "max" input. The server re-checks.
   */
  function refundableFor(charge: Payment): number {
    if (charge.amount <= 0 || charge.status !== 'SUCCEEDED') return 0;
    const refunded = payments
      .filter((p) => p.refundOfPaymentId === charge.id && p.status === 'SUCCEEDED')
      .reduce((acc, r) => acc + r.amount, 0); // refunds carry negative amounts
    return charge.amount + refunded;
  }

  async function refund(target: Payment, amt: number, reason: string): Promise<void> {
    setBusy(true);
    setRefundError(null);
    try {
      const body: { amount: number; reason?: string } = { amount: amt };
      if (reason.trim()) body.reason = reason.trim();
      const res = await api.post<RecordPaymentResponse>(
        `/v1/houses/${houseId}/units/${unitId}/leases/${leaseId}/bills/${billId}/payments/${target.id}/refund`,
        body,
      );
      setPayments((prev) => [...prev, res.payment]);
      setRefundTarget(null);
      router.refresh();
    } catch (err) {
      setRefundError(err instanceof ApiError ? err.problem.title : 'Failed to refund');
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
                  <th className="px-4 py-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const isRefund = p.amount < 0 || p.refundOfPaymentId !== null;
                  const refundable = refundableFor(p);
                  return (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(p.receivedAt ?? p.createdAt)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          isRefund ? 'text-rose-700' : ''
                        }`}
                      >
                        {formatMoney(p.amount, p.currency)}
                        {isRefund && (
                          <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-800">
                            refund
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{p.provider.toLowerCase()}</td>
                      <td className="px-4 py-3 text-xs">{p.providerRef ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{p.note ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        {!isRefund && refundable > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setRefundError(null);
                              setRefundTarget(p);
                            }}
                          >
                            Refund
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        )}
      </Card>

      {refundTarget && (
        <RefundDialog
          target={refundTarget}
          refundable={refundableFor(refundTarget)}
          busy={busy}
          error={refundError}
          onCancel={() => setRefundTarget(null)}
          onSubmit={(amt, reason) => refund(refundTarget, amt, reason)}
        />
      )}

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

function RefundDialog({
  target,
  refundable,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  target: Payment;
  refundable: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (amount: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState<string>(String(refundable));
  const [reason, setReason] = useState('');

  function handle(e: React.FormEvent): void {
    e.preventDefault();
    const amt = Number.parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt <= 0) return;
    onSubmit(amt, reason);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Refund payment</CardTitle>
        <CardDescription>
          Refundable from {target.provider.toLowerCase()} payment of{' '}
          {formatMoney(target.amount, target.currency)}: {formatMoney(refundable, target.currency)}.{' '}
          {target.provider === 'STRIPE'
            ? 'This will issue a refund via the Stripe API.'
            : target.provider === 'VNPAY'
              ? 'VNPay refunds are not supported here — process via the VNPay dashboard then record a MANUAL refund.'
              : 'Local-only record. Make sure you have actually returned the money out-of-band.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handle}>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Refund failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="refundAmount">Amount (minor units, {target.currency})</Label>
            <Input
              id="refundAmount"
              type="number"
              inputMode="numeric"
              min={1}
              max={refundable}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="refundReason">Reason (optional)</Label>
            <Textarea
              id="refundReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} variant="destructive">
              {busy && <Spinner />}
              Issue refund
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
