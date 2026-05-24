'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import type { PartnerProfile, StartStripeOnboardingResponse } from '@repo/shared';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui';

import { ApiError, api } from '../../../lib/api';

/**
 * Stripe Connect onboarding card. Shown alongside the profile form on
 * `/profile`. Renders one of three states based on
 * `profile.stripeConnectStatus`:
 *   - NOT_STARTED / ONBOARDING → "Connect with Stripe" button
 *   - ACTIVE → green badge + onboarded-on date
 *   - RESTRICTED → red badge + "Re-onboard" button
 */
export function StripeConnectCard({ profile }: { profile: PartnerProfile }) {
  const t = useTranslations('partner.profile.stripe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = profile.stripeConnectStatus;

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<StartStripeOnboardingResponse>(
        '/v1/me/partner-profile/stripe-onboarding',
      );
      window.location.href = res.url;
    } catch (err) {
      const message =
        err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : t('unexpectedError');
      setError(message);
      setBusy(false);
    }
  }

  if (status === 'ACTIVE') {
    const date = profile.stripeConnectOnboardedAt
      ? new Date(profile.stripeConnectOnboardedAt).toLocaleDateString()
      : t('activeFallbackDate');
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>
            {t.rich('activeBody', {
              active: () => (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                  ● {t('active')}
                </span>
              ),
              date,
            })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === 'RESTRICTED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('title')}</CardTitle>
          <CardDescription>
            {t.rich('restrictedBody', {
              restricted: () => (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900">
                  ● {t('restricted')}
                </span>
              ),
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleStart} disabled={busy}>
            {busy ? t('redirecting') : t('reonboardButton')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // NOT_STARTED / ONBOARDING — partner hasn't finished setup yet.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('title')}</CardTitle>
        <CardDescription>
          {status === 'ONBOARDING' ? t('onboardingBody') : t('notStartedBody')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button onClick={handleStart} disabled={busy}>
          {busy ? t('redirecting') : t('connectButton')}
        </Button>
      </CardContent>
    </Card>
  );
}
