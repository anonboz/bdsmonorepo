import { Injectable } from '@nestjs/common';

import { env } from '../env.js';
import {
  buildCheckoutSessionCreateParams,
  getStripeClient,
  type CheckoutSession,
  type CreateCheckoutSessionParams,
  type StripeEvent,
} from './stripe.client.js';

/**
 * NestJS-DI face over `stripe.client.ts`. The thin wrapper exists so
 * the PaymentsService + WebhooksService can inject a mock in unit
 * tests without spinning up a real Stripe client — the bare
 * class-with-method shape works directly with `new MockStripeService()`
 * in vitest.
 */
@Injectable()
export class StripeService {
  /** True when `STRIPE_SECRET_KEY` is set; the controller maps this to 503. */
  isEnabled(): boolean {
    return getStripeClient() !== null;
  }

  /** True when both the secret key AND the webhook signing secret are configured. */
  isWebhookEnabled(): boolean {
    return Boolean(env.STRIPE_WEBHOOK_SECRET) && this.isEnabled();
  }

  async createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession> {
    const client = getStripeClient();
    if (!client) {
      // Defensive — controllers should branch on `isEnabled()` first.
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const session = await client.checkout.sessions.create(buildCheckoutSessionCreateParams(params));
    return { id: session.id, url: session.url };
  }

  /**
   * Verifies the Stripe-Signature header against `STRIPE_WEBHOOK_SECRET`
   * and returns the parsed event. Throws
   * `Stripe.errors.StripeSignatureVerificationError` on mismatch —
   * the controller maps that to 400 `payments.webhook_invalid`.
   */
  constructEvent(rawBody: string, signature: string): StripeEvent {
    const client = getStripeClient();
    if (!client || !env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('Stripe webhook secret not configured.');
    }
    return client.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  }

  /**
   * Issues a refund against a Stripe PaymentIntent (Phase 7.5).
   * Returns the minimum we need locally — the refund id and its sync
   * status. Stripe's synchronous response is `succeeded` for most
   * card-not-present flows; rarer `pending` cases get a follow-up
   * `charge.refunded` event we don't process in v1.
   */
  async createRefund(args: {
    paymentIntentId: string;
    amount: number;
    reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    metadata?: Record<string, string>;
  }): Promise<{ id: string; status: string | null }> {
    const client = getStripeClient();
    if (!client) {
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const refund = await client.refunds.create({
      payment_intent: args.paymentIntentId,
      amount: args.amount,
      reason: args.reason ?? 'requested_by_customer',
      metadata: args.metadata,
    });
    return { id: refund.id, status: refund.status };
  }

  // ---- Stripe Connect (Phase 9.1) -----------------------------------

  /**
   * Creates a Stripe Express account for a partner. Idempotency is
   * handled at the caller layer — we record the returned `acct_*` id
   * on PartnerProfile so a re-onboarding click reuses the account.
   *
   * Country/currency are hardcoded to VN/VND in v1 (single-currency
   * stack). Multi-region partners are an explicit Phase 9 out-of-scope.
   */
  async createConnectAccount(args: {
    email: string | null;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }> {
    const client = getStripeClient();
    if (!client) {
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const account = await client.accounts.create({
      type: 'express',
      country: 'VN',
      default_currency: 'vnd',
      email: args.email ?? undefined,
      capabilities: {
        transfers: { requested: true },
      },
      metadata: args.metadata,
    });
    return { id: account.id };
  }

  /**
   * Generates a short-lived (~5 minute) hosted-onboarding URL. The
   * `refresh_url` is what Stripe redirects to if the link expires
   * mid-flow; we point it back at our own endpoint so the partner
   * just gets a fresh link and retries.
   */
  async createAccountLink(args: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: Date }> {
    const client = getStripeClient();
    if (!client) {
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const link = await client.accountLinks.create({
      account: args.accountId,
      refresh_url: args.refreshUrl,
      return_url: args.returnUrl,
      type: 'account_onboarding',
    });
    return {
      url: link.url,
      // Stripe returns `expires_at` as unix seconds; lift to a Date.
      expiresAt: new Date(link.expires_at * 1000),
    };
  }

  /**
   * Reads back an Express account — used by the webhook handler to
   * pull `charges_enabled` / `payouts_enabled` after `account.updated`.
   * The webhook payload already carries these, but a defensive read
   * lets us reconcile on out-of-order events.
   */
  async retrieveAccount(accountId: string): Promise<{
    id: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    requirementsDisabledReason: string | null;
  }> {
    const client = getStripeClient();
    if (!client) {
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const account = await client.accounts.retrieve(accountId);
    return {
      id: account.id,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      requirementsDisabledReason: account.requirements?.disabled_reason ?? null,
    };
  }

  /**
   * Pushes funds to a partner's Stripe-held balance. Called from
   * PayoutsService.markDisbursed when the admin picks STRIPE_CONNECT.
   * The returned `tr_*` id becomes our `disbursementRef`.
   */
  async createTransfer(args: {
    destination: string;
    amount: number;
    currency: string;
    metadata?: Record<string, string>;
  }): Promise<{ id: string }> {
    const client = getStripeClient();
    if (!client) {
      throw new Error('Stripe client not initialised — STRIPE_SECRET_KEY is unset.');
    }
    const transfer = await client.transfers.create({
      destination: args.destination,
      amount: args.amount,
      currency: args.currency.toLowerCase(),
      metadata: args.metadata,
    });
    return { id: transfer.id };
  }
}
