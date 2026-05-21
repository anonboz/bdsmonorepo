import { Injectable } from '@nestjs/common';

import {
  buildCheckoutSessionCreateParams,
  getStripeClient,
  type CheckoutSession,
  type CreateCheckoutSessionParams,
} from './stripe.client.js';

/**
 * NestJS-DI face over `stripe.client.ts`. The thin wrapper exists so
 * the PaymentsService can inject a mock in unit tests without spinning
 * up a real Stripe client — the bare class-with-method shape works
 * directly with `new MockStripeService()` in vitest.
 */
@Injectable()
export class StripeService {
  /** True when `STRIPE_SECRET_KEY` is set; the controller maps this to 503. */
  isEnabled(): boolean {
    return getStripeClient() !== null;
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
}
