'use client';

import { useState } from 'react';

import type { BillStatus, CreateCheckoutSessionResponse } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

const PAYABLE_STATES: BillStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

type Provider = 'stripe' | 'vnpay';

export function PayOnline({ billId, billStatus }: { billId: string; billStatus: BillStatus }) {
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState<Record<Provider, boolean>>({
    stripe: false,
    vnpay: false,
  });

  if (!PAYABLE_STATES.includes(billStatus)) {
    return (
      <p className="text-sm text-muted-foreground">
        {billStatus === 'PAID'
          ? 'This bill is paid in full.'
          : 'Online payment is not available for this bill yet.'}
      </p>
    );
  }

  async function pay(provider: Provider): Promise<void> {
    setBusy(provider);
    setError(null);
    try {
      const path =
        provider === 'stripe'
          ? `/v1/me/bills/${billId}/checkout`
          : `/v1/me/bills/${billId}/vnpay/checkout`;
      const res = await api.post<CreateCheckoutSessionResponse>(path);
      window.location.assign(res.url);
    } catch (err) {
      if (err instanceof ApiError && err.problem.type === 'payments.provider_disabled') {
        setDisabled((d) => ({ ...d, [provider]: true }));
      } else {
        setError(err instanceof ApiError ? err.problem.title : 'Could not start checkout');
      }
    } finally {
      setBusy(null);
    }
  }

  const bothDisabled = disabled.stripe && disabled.vnpay;
  if (bothDisabled) {
    return (
      <Alert>
        <AlertTitle>Online payment not enabled</AlertTitle>
        <AlertDescription>
          Neither Stripe nor VNPay is configured on this deployment. Settle directly with your
          landlord — they can record the payment for you.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not start checkout</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {!disabled.stripe && (
          <Button onClick={() => pay('stripe')} disabled={busy !== null}>
            {busy === 'stripe' && <Spinner />}
            Pay with Stripe
          </Button>
        )}
        {!disabled.vnpay && (
          <Button onClick={() => pay('vnpay')} disabled={busy !== null} variant="outline">
            {busy === 'vnpay' && <Spinner />}
            Pay with VNPay
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        You will be redirected to the provider&apos;s secure checkout page. We never see your card
        details.
        {disabled.stripe && !disabled.vnpay && ' Stripe is not configured on this deployment.'}
        {!disabled.stripe && disabled.vnpay && ' VNPay is not configured on this deployment.'}
      </p>
    </div>
  );
}
