// eslint-disable-next-line @typescript-eslint/no-require-imports
import Stripe = require('stripe');

import { env } from '../env.js';

/**
 * Thin wrapper around the Stripe SDK so tests can inject a mock
 * without spinning up a real Stripe client. Returns `null` when no
 * key is configured — the checkout endpoint maps that to a 503.
 *
 * `import = require` is the documented form for stripe-node's
 * `export = StripeConstructor` shape.
 */

type StripeInstance = Stripe.Stripe;

let cached: StripeInstance | null | undefined;

export function getStripeClient(): StripeInstance | null {
  if (cached !== undefined) return cached;
  if (!env.STRIPE_SECRET_KEY) {
    cached = null;
    return null;
  }
  cached = new Stripe(env.STRIPE_SECRET_KEY, {
    typescript: true,
    appInfo: { name: 'bdsmonorepo' },
  });
  return cached;
}

/** Tests reset between cases so a mock client doesn't leak across them. */
export function resetStripeClientForTests(): void {
  cached = undefined;
}

/**
 * Minimal Checkout Session interface our service uses. Stripe's
 * full `Checkout.Session` carries a lot more — narrowing this means
 * we only depend on the fields we actually read.
 */
export interface CheckoutSession {
  id: string;
  url: string | null;
}

export interface CreateCheckoutSessionParams {
  customerEmail: string | null;
  billId: string;
  tenantId: string;
  paymentId: string;
  description: string;
  amount: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Derives the Stripe SDK's exact `Checkout.Session` create-params
 * type from the instance method signature. Avoids the namespace
 * import gymnastics needed to spell `Stripe.Stripe.Checkout.*`
 * directly with stripe-node v22's `export = StripeConstructor`
 * type shape.
 */
type SessionCreateParams = Parameters<StripeInstance['checkout']['sessions']['create']>[0];

/**
 * Builds the Stripe `Checkout.Session` create payload from the
 * narrowed params above. Exported so the service layer doesn't carry
 * Stripe-SDK shapes, and so tests can assert exact payloads.
 */
export function buildCheckoutSessionCreateParams(
  p: CreateCheckoutSessionParams,
): SessionCreateParams {
  return {
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: p.customerEmail ?? undefined,
    client_reference_id: p.billId,
    metadata: {
      billId: p.billId,
      tenantId: p.tenantId,
      paymentId: p.paymentId,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: p.currency.toLowerCase(),
          product_data: {
            name: `Bill ${p.billId}`,
            description: p.description,
          },
          // Stripe expects integer minor units, which matches our
          // storage convention everywhere else in the codebase.
          unit_amount: p.amount,
        },
      },
    ],
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
  };
}
