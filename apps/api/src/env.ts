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
  POSTHOG_HOST: url().default('https://us.i.posthog.com'),

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
   * Origin of the partner app — surfaces in Stripe Connect onboarding
   * URLs (refresh + return paths). Defaults to the local dev port.
   */
  PARTNER_APP_URL: url().default('http://localhost:3030'),

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
  /**
   * VNPay merchant_webapi endpoint for refund (and other server-to-server
   * queries). Sandbox by default; production swaps to the live host.
   */
  VNPAY_REFUND_URL: url().default('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
  /** Locale for VNPay's hosted page (`"vn"` or `"en"`). */
  VNPAY_LOCALE: z.string().default('vn'),

  /**
   * S3-compatible storage config — points at the local MinIO by
   * default (see docker-compose.yml). All four are required for
   * StorageService to be considered "enabled"; when any is missing
   * the service throws 503 `storage.disabled` on every call.
   */
  S3_ENDPOINT: url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_BUCKET_UPLOADS: z.string().default('bds-uploads'),
  /** Path-style URLs are required for MinIO; production S3 prefers vhost-style. */
  S3_FORCE_PATH_STYLE: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),
  /**
   * Public-facing URL prefix for embeds. When set, the client gets
   * `${S3_PUBLIC_BASE}/${bucket}/${key}` instead of the SDK endpoint —
   * useful in prod where the SDK talks to the bucket directly but
   * embeds go through CloudFront / an internal proxy. Empty string
   * means "use S3_ENDPOINT".
   */
  S3_PUBLIC_BASE: z.string().default(''),
  /** Lifetime of presigned PUT URLs, seconds. Default 5 minutes. */
  S3_PRESIGN_EXPIRES_SEC: z.coerce.number().int().positive().default(300),
});

export const env = loadEnv(envSchema);
export type Env = typeof env;
