'use client';

import { useState } from 'react';

import type { BillStatus, CreateCheckoutSessionResponse } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

const PAYABLE_STATES: BillStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

export function PayOnline({ billId, billStatus }: { billId: string; billStatus: BillStatus }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);

  if (!PAYABLE_STATES.includes(billStatus)) {
    return (
      <p className="text-sm text-muted-foreground">
        {billStatus === 'PAID'
          ? 'This bill is paid in full.'
          : 'Online payment is not available for this bill yet.'}
      </p>
    );
  }

  async function pay(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<CreateCheckoutSessionResponse>(`/v1/me/bills/${billId}/checkout`);
      // Stripe's hosted page. Same-tab navigation matches the Stripe
      // docs default — return URLs land us back on /payment-success
      // or /payment-cancelled.
      window.location.assign(res.url);
    } catch (err) {
      if (err instanceof ApiError && err.problem.type === 'payments.provider_disabled') {
        setDisabled(true);
      } else {
        setError(err instanceof ApiError ? err.problem.title : 'Could not start checkout');
      }
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <Alert>
        <AlertTitle>Online payment not enabled</AlertTitle>
        <AlertDescription>
          Stripe is not configured on this deployment. Settle directly with your landlord — they can
          record the payment for you.
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
      <Button onClick={pay} disabled={busy}>
        {busy && <Spinner />}
        Pay online with Stripe
      </Button>
      <p className="text-xs text-muted-foreground">
        You will be redirected to Stripe&apos;s secure checkout page. We never see your card
        details.
      </p>
    </div>
  );
}
