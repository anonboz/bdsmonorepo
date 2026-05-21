// Side-effect: load apps/api/.env into process.env before the validator runs.
// Skipped in production where env is set by the runtime (Docker, Vercel, etc.).
import 'dotenv/config';

import { z } from 'zod';

import { databaseUrl, loadEnv, nodeEnv, port, redisUrl, url } from '@repo/config/env';

const envSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: port.default(3001),
  API_PUBLIC_URL: url().default('http://localhost:3001'),
  API_CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:3000,http://localhost:3010,http://localhost:3020,http://localhost:3030',
    )
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,

  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars'),

  // Set to 'true' in unit tests or any process that should not connect to
  // Redis / register workers. Default: queues are on whenever NODE_ENV is
  // not 'test'.
  API_DISABLE_QUEUES: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  // Set to 'true' to skip @fastify/rate-limit registration entirely.
  // Useful for the e2e hammer paths and quick local debugging. Default off.
  API_DISABLE_RATE_LIMIT: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  // Set to 'true' to force the in-memory stub mailer regardless of
  // RESEND_API_KEY / SMTP_HOST. The e2e CI block sets this; tests
  // can also opt-in for noise-free runs.
  API_DISABLE_MAILER: z
    .union([z.literal('true'), z.literal('false')])
    .default('false')
    .transform((v) => v === 'true'),

  AUTH_JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  AUTH_JWT_REFRESH_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  AUTH_COOKIE_DOMAIN: z.string().default('localhost'),

  EMAIL_FROM: z.string().default('BDS <no-reply@localhost>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: port.default(1025),

  SENTRY_DSN: z.string().url().optional(),
  /** Tag passed to Sentry for release-based grouping. Free-form. */
  SENTRY_RELEASE: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),

  /**
   * Stripe secret key. When unset the checkout endpoint returns 503
   * `payments.provider_disabled` so devs running without a Stripe
   * test account aren't blocked from booting the API.
   */
  STRIPE_SECRET_KEY: z.string().optional(),
  /**
   * Used by 7.3's webhook handler to verify the `Stripe-Signature`
   * header. Documented now so the env shape is fully declared in
   * one place.
   */
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Origin of the tenant app — surfaces in Stripe Checkout's success
   * + cancel URLs. Defaults to the local dev port.
   */
  TENANT_APP_URL: url().default('http://localhost:3020'),

  /**
   * VNPay merchant code from the VNPay dashboard. When unset, the
   * VNPay checkout endpoint returns 503 `payments.provider_disabled`.
   */
  VNPAY_TMN_CODE: z.string().optional(),
  /** VNPay HMAC-SHA512 secret. Same secret signs requests + verifies IPN. */
  VNPAY_HASH_SECRET: z.string().optional(),
  /**
   * VNPay hosted-page URL. Sandbox by default; production swaps to
   * `https://pay.vnpay.vn/vpcpay.html`.
   */
  VNPAY_PAYMENT_URL: url().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  /** Locale for VNPay's hosted page (`"vn"` or `"en"`). */
  VNPAY_LOCALE: z.string().default('vn'),
});

export const env = loadEnv(envSchema);
export type Env = typeof env;
