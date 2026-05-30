// Side-effect: load apps/api/.env into process.env before the validator runs.
// Skipped in production where env is set by the runtime (Docker, Vercel, etc.).
import 'dotenv/config';

import { z } from 'zod';

import { databaseUrl, loadEnv, nodeEnv, port, redisUrl, url } from '@repo/config/env';

const envSchema = z.object({
  NODE_ENV: nodeEnv,
  API_PORT: port.default(4001),
  API_PUBLIC_URL: url().default('http://localhost:4001'),
  /**
   * Comma-separated list of origins allowed to call the API with
   * credentials. Local dev defaults to the four PWA ports; production
   * lists the four `{admin,owner,tenant,partner}.<domain>` subdomains
   * per ADR-0001 (plus a wildcard for Vercel preview URLs if used).
   */
  API_CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:4000,http://localhost:4010,http://localhost:4020,http://localhost:4030',
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
  /**
   * Cookie domain for the session + locale cookies. Local dev uses
   * `localhost` so cookies stay on `localhost:*` only; production uses
   * a leading-dot parent domain (e.g. `.bdsmonorepo.vn`) so a single
   * session works across `{admin,owner,tenant,partner}.<domain>` per
   * ADR-0001. Better-auth's `crossSubDomainCookies` block is only
   * activated when NODE_ENV === 'production'.
   */
  AUTH_COOKIE_DOMAIN: z.string().default('localhost'),

  EMAIL_FROM: z.string().default('BDS <no-reply@localhost>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: port.default(1025),

  /**
   * Phase 10.5 — VAPID keypair for web-push. When unset the push
   * fanout is a no-op (worker logs once on boot) and the
   * `POST /push-subscriptions` endpoint returns 503
   * `push.provider_disabled`. Keep `_PRIVATE_KEY` server-only;
   * `_PUBLIC_KEY` is what the PWA reads via `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
   * `VAPID_SUBJECT` is the `mailto:` / URL the push provider contacts
   * about issues; required by the spec.
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@localhost'),

  SENTRY_DSN: z.string().url().optional(),
  /** Tag passed to Sentry for release-based grouping. Free-form. */
  SENTRY_RELEASE: z.string().optional(),
  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: url().default('https://us.i.posthog.com'),
  /**
   * PostHog Personal API key (admin-scoped). Required only for
   * GDPR-erasure deletion of a person; the ingest path uses
   * `POSTHOG_KEY` which has no delete permission. Keep these split
   * so a leak of either limits blast radius.
   */
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),

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
   * Origin of the tenant app — surfaces in Stripe / VNPay / MoMo
   * return URLs and any cross-app link composed server-side.
   * Defaults to the local dev port. Production: per ADR-0001 this is
   * a subdomain of the platform domain (e.g. `https://tenant.bdsmonorepo.vn`).
   */
  TENANT_APP_URL: url().default('http://localhost:4020'),
  /**
   * Origin of the owner app — same shape as `TENANT_APP_URL`.
   * Surfaces in any server-rendered link the API hands to owners
   * (e.g. notification CTA URLs). Phase 12.2 added; defaults to the
   * local dev port (4010).
   */
  OWNER_APP_URL: url().default('http://localhost:4010'),
  /**
   * Origin of the partner app — surfaces in Stripe Connect onboarding
   * URLs (refresh + return paths). Defaults to the local dev port.
   */
  PARTNER_APP_URL: url().default('http://localhost:4030'),
  /**
   * Origin of the admin app. Phase 12.2 added; admin is the most
   * sensitive surface so it gets its own env var even though no
   * server-side code currently composes admin links — keeping the
   * shape symmetric across the four PWAs makes per-environment
   * config diffs easier to read. Defaults to the local dev port (4000).
   */
  ADMIN_APP_URL: url().default('http://localhost:4000'),

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
   * MoMo partner code from the MoMo Business dashboard. When unset
   * (together with ACCESS_KEY / SECRET_KEY), the MoMo checkout endpoint
   * returns 503 `payments.provider_disabled`.
   */
  MOMO_PARTNER_CODE: z.string().optional(),
  /** MoMo accessKey — public-ish, but part of the signed canonical string. */
  MOMO_ACCESS_KEY: z.string().optional(),
  /** MoMo HMAC-SHA256 secret. Same secret signs requests + verifies IPN. */
  MOMO_SECRET_KEY: z.string().optional(),
  /**
   * MoMo's create-payment endpoint. Sandbox by default; production
   * swaps to `https://payment.momo.vn/v2/gateway/api/create`.
   */
  MOMO_CREATE_URL: url().default('https://test-payment.momo.vn/v2/gateway/api/create'),

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

  /**
   * Phase 11.6 — SMS provider selection. `mock` logs the OTP to the
   * console + stashes it in an in-memory inbox (for dev + tests).
   * `esms-vn` POSTs to esms.vn's `SendMultipleMessage_V4_post_json`
   * endpoint; needs the API/secret pair below and (optionally) a
   * registered brandname.
   */
  SMS_PROVIDER: z.enum(['mock', 'esms-vn']).default('mock'),
  ESMS_VN_API_KEY: z.string().optional(),
  ESMS_VN_SECRET_KEY: z.string().optional(),
  /**
   * Registered brandname. Optional — when unset, esms.vn sends the
   * SMS from a generated random shortcode (cheaper, less trustworthy
   * on the recipient's end).
   */
  ESMS_VN_BRAND_NAME: z.string().optional(),
  /**
   * esms.vn JSON endpoint. Pinned here so the test suite can swap to
   * a mock server without monkey-patching `fetch`.
   */
  ESMS_VN_API_URL: url().default(
    'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/',
  ),
});

export const env = loadEnv(envSchema);
export type Env = typeof env;
