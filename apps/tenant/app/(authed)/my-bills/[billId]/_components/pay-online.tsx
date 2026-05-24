'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { BillStatus, CreateCheckoutSessionResponse } from '@repo/shared';
import { Alert, AlertDescription, AlertTitle, Button, Spinner } from '@repo/ui';

import { ApiError, api } from '../../../../../lib/api';

const PAYABLE_STATES: BillStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

type Provider = 'stripe' | 'vnpay';

export function PayOnline({ billId, billStatus }: { billId: string; billStatus: BillStatus }) {
  const t = useTranslations('tenant.bills.payOnline');
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState<Record<Provider, boolean>>({
    stripe: false,
    vnpay: false,
  });

  if (!PAYABLE_STATES.includes(billStatus)) {
    return (
      <p className="text-sm text-muted-foreground">
        {billStatus === 'PAID' ? t('alreadyPaid') : t('notAvailable')}
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
        setError(err instanceof ApiError ? err.problem.title : t('couldNotStart'));
      }
    } finally {
      setBusy(null);
    }
  }

  const bothDisabled = disabled.stripe && disabled.vnpay;
  if (bothDisabled) {
    return (
      <Alert>
        <AlertTitle>{t('neitherTitle')}</AlertTitle>
        <AlertDescription>{t('neitherBody')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t('couldNotStart')}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {!disabled.stripe && (
          <Button onClick={() => pay('stripe')} disabled={busy !== null}>
            {busy === 'stripe' && <Spinner />}
            {t('payStripe')}
          </Button>
        )}
        {!disabled.vnpay && (
          <Button onClick={() => pay('vnpay')} disabled={busy !== null} variant="outline">
            {busy === 'vnpay' && <Spinner />}
            {t('payVnpay')}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('redirectNote')}
        {disabled.stripe && !disabled.vnpay && t('stripeDisabledNote')}
        {!disabled.stripe && disabled.vnpay && t('vnpayDisabledNote')}
      </p>
    </div>
  );
}
