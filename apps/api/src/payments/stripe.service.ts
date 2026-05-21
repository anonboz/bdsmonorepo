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
}
