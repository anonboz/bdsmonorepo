'use client';

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
 *
 * Clicking the button POSTs to `/v1/me/partner-profile/stripe-onboarding`,
 * then redirects the browser to Stripe's hosted onboarding URL.
 */
export function StripeConnectCard({ profile }: { profile: PartnerProfile }) {
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
        err instanceof ApiError ? (err.problem.detail ?? err.problem.title) : 'Unexpected error';
      setError(message);
      setBusy(false);
    }
  }

  if (status === 'ACTIVE') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payouts via Stripe</CardTitle>
          <CardDescription>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
              ● Active
            </span>{' '}
            since{' '}
            {profile.stripeConnectOnboardedAt
              ? new Date(profile.stripeConnectOnboardedAt).toLocaleDateString()
              : '—'}
            . Admins can disburse your payouts to your Stripe-held balance.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status === 'RESTRICTED') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Payouts via Stripe</CardTitle>
          <CardDescription>
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-900">
              ● Restricted
            </span>{' '}
            Stripe has paused payouts on your account. Re-onboard to resolve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button onClick={handleStart} disabled={busy}>
            {busy ? 'Redirecting…' : 'Re-onboard with Stripe'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // NOT_STARTED / ONBOARDING — partner hasn't finished setup yet.
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Payouts via Stripe</CardTitle>
        <CardDescription>
          {status === 'ONBOARDING'
            ? 'Onboarding in progress. Pick up where you left off — Stripe remembers your progress.'
            : 'Get paid into your own Stripe-managed bank account. Onboarding is a few minutes and handles KYC for you.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button onClick={handleStart} disabled={busy}>
          {busy ? 'Redirecting…' : 'Connect with Stripe'}
        </Button>
      </CardContent>
    </Card>
  );
}
