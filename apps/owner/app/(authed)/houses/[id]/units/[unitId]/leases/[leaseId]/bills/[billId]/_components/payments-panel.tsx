'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useFormatters } from '@repo/i18n';
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
  const t = useTranslations('owner.bills.payments');
  const { formatDateTime, formatMoney } = useFormatters();
  const router = useRouter();
  const [payments, setPayments] = useState<Payment[]>(initialPayments);
  const [amount, setAmount] = useState<string>(String(remaining));
  const [providerRef, setProviderRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);

  const canRecord = PAYABLE_STATES.includes(billStatus);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const amt = Number.parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(t('amountInvalid'));
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
      setError(err instanceof ApiError ? err.problem.title : t('recordFailed'));
    } finally {
      setBusy(false);
    }
  }

  function refundableFor(charge: Payment): number {
    if (charge.amount <= 0 || charge.status !== 'SUCCEEDED') return 0;
    const refunded = payments
      .filter((p) => p.refundOfPaymentId === charge.id && p.status === 'SUCCEEDED')
      .reduce((acc, r) => acc + r.amount, 0);
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
      setRefundError(err instanceof ApiError ? err.problem.title : t('refundFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>
            {payments.length === 0 ? t('empty') : t('count', { count: payments.length })}
          </CardDescription>
        </CardHeader>
        {payments.length > 0 && (
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-y text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('tableReceived')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('tableAmount')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableProvider')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableRef')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableNote')}</th>
                  <th className="px-4 py-2 font-medium">{t('tableAction')}</th>
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
                            {t('refundBadge')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{p.provider.toLowerCase()}</td>
                      <td className="px-4 py-3 text-xs">{p.providerRef ?? t('noneDash')}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.note ?? t('noneDash')}
                      </td>
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
                            {t('refundButton')}
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
            <CardTitle className="text-lg">{t('recordTitle')}</CardTitle>
            <CardDescription>
              {t('recordSubtitle', { amount: formatMoney(remaining, currency) })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>{t('recordFailedTitle')}</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="grid gap-2">
                <Label htmlFor="amount">{t('amountLabel', { currency })}</Label>
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
                <Label htmlFor="providerRef">{t('refLabel')}</Label>
                <Input
                  id="providerRef"
                  placeholder={t('refPlaceholder')}
                  value={providerRef}
                  onChange={(e) => setProviderRef(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="note">{t('noteLabel')}</Label>
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
                {t('recordButton')}
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
  const t = useTranslations('owner.bills.payments');
  const tChrome = useTranslations('owner.chrome');
  const { formatMoney } = useFormatters();
  const [amount, setAmount] = useState<string>(String(refundable));
  const [reason, setReason] = useState('');

  function handle(e: React.FormEvent): void {
    e.preventDefault();
    const amt = Number.parseInt(amount, 10);
    if (!Number.isFinite(amt) || amt <= 0) return;
    onSubmit(amt, reason);
  }

  const provider = target.provider.toLowerCase();
  const subtitleArgs = {
    provider,
    amount: formatMoney(target.amount, target.currency),
    remaining: formatMoney(refundable, target.currency),
  };
  const subtitle =
    target.provider === 'STRIPE'
      ? t('refundDialogSubtitleStripe', subtitleArgs)
      : target.provider === 'VNPAY'
        ? t('refundDialogSubtitleVnpay', subtitleArgs)
        : t('refundDialogSubtitleManual', subtitleArgs);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('refundDialogTitle')}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handle}>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t('refundFailedTitle')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="grid gap-2">
            <Label htmlFor="refundAmount">
              {t('refundAmountLabel', { currency: target.currency })}
            </Label>
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
            <Label htmlFor="refundReason">{t('refundReasonLabel')}</Label>
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
              {t('issueRefundButton')}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {tChrome('cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
