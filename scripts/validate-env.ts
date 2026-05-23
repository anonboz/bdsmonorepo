#!/usr/bin/env tsx
/**
 * Env-var validator (Phase 9.7).
 *
 * Reads a target environment from the CLI (`production` or `staging`),
 * checks that every required var for that target is set + non-empty
 * in `process.env`, and exits non-zero with a printed list of
 * missing vars on failure.
 *
 * Source of truth for "what must be set in prod". When you add a
 * new env-var to `apps/api/src/env.ts` that must be configured in
 * a deploy, add it to the appropriate manifest below — the deploy
 * CI job catches the omission before it ships.
 *
 * Usage:
 *   pnpm tsx scripts/validate-env.ts production
 *   pnpm tsx scripts/validate-env.ts staging
 *
 * Exit codes:
 *   0  every required var present + non-empty
 *   1  one or more required vars missing
 *   2  invalid CLI usage (bad target, no arg, etc.)
 */

interface VarSpec {
  name: string;
  /** Surfaced when the var is missing — explains *why* it's required so
   *  the operator can fix the right thing instead of grep-guessing. */
  reason: string;
}

const CORE: VarSpec[] = [
  { name: 'NODE_ENV', reason: 'sets server-side fail-closed defaults' },
  { name: 'DATABASE_URL', reason: 'API cannot start without DB' },
  { name: 'REDIS_URL', reason: 'BullMQ queues + sweepers' },
  { name: 'API_PUBLIC_URL', reason: 'OAuth + webhook callback origin' },
  { name: 'API_CORS_ORIGINS', reason: 'comma-sep PWA origins; CORS preflights 403 without' },
];

const AUTH: VarSpec[] = [
  { name: 'AUTH_SECRET', reason: 'session signing — leak = full takeover; min 32 bytes' },
  { name: 'AUTH_JWT_ACCESS_TTL', reason: 'access-token TTL in seconds' },
  { name: 'AUTH_JWT_REFRESH_TTL', reason: 'refresh-token TTL in seconds' },
  { name: 'AUTH_COOKIE_DOMAIN', reason: 'cross-subdomain cookie scope (e.g. .example.com)' },
];

const PAYMENTS: VarSpec[] = [
  { name: 'STRIPE_SECRET_KEY', reason: 'Stripe checkout, refunds, and Connect transfers' },
  { name: 'STRIPE_WEBHOOK_SECRET', reason: 'Stripe webhook signature verification' },
  { name: 'VNPAY_TMN_CODE', reason: 'VNPay merchant identifier for payment URLs' },
  { name: 'VNPAY_HASH_SECRET', reason: 'VNPay HMAC-SHA512 for checkout, IPN, refund' },
  { name: 'VNPAY_PAYMENT_URL', reason: 'VNPay hosted-page URL (sandbox vs prod)' },
  { name: 'VNPAY_REFUND_URL', reason: 'VNPay merchant_webapi refund endpoint' },
  { name: 'TENANT_APP_URL', reason: 'Stripe + VNPay redirect target' },
  { name: 'PARTNER_APP_URL', reason: 'Stripe Connect onboarding return URL' },
];

const STORAGE: VarSpec[] = [
  { name: 'S3_ENDPOINT', reason: 'S3 / MinIO endpoint' },
  { name: 'S3_REGION', reason: 'AWS region for the bucket' },
  { name: 'S3_ACCESS_KEY_ID', reason: 'IAM credentials for signed PUT URLs' },
  { name: 'S3_SECRET_ACCESS_KEY', reason: 'IAM credentials' },
  { name: 'S3_BUCKET_UPLOADS', reason: 'destination bucket for media uploads' },
];

const EMAIL: VarSpec[] = [
  { name: 'RESEND_API_KEY', reason: 'email delivery; else falls back to MailHog/stub' },
  { name: 'EMAIL_FROM', reason: 'From: header for all outbound email' },
];

const OBSERVABILITY: VarSpec[] = [
  { name: 'SENTRY_DSN', reason: 'API error reporting' },
  { name: 'POSTHOG_KEY', reason: 'PostHog ingest (server-side analytics)' },
  { name: 'POSTHOG_HOST', reason: 'PostHog regional ingest host' },
];

const PRODUCTION_REQUIRED: VarSpec[] = [
  ...CORE,
  ...AUTH,
  ...PAYMENTS,
  ...STORAGE,
  ...EMAIL,
  ...OBSERVABILITY,
];

// Staging mirrors prod but accepts a missing VNPay/Stripe secret
// (test-mode keys are fine if they're set; the check below requires
// them so we don't ship to staging without test creds either).
const STAGING_REQUIRED: VarSpec[] = PRODUCTION_REQUIRED;

const MANIFESTS: Record<string, VarSpec[]> = {
  production: PRODUCTION_REQUIRED,
  staging: STAGING_REQUIRED,
};

function main(): void {
  const target = process.argv[2];
  if (!target || !(target in MANIFESTS)) {
    process.stderr.write(
      `Usage: pnpm tsx scripts/validate-env.ts <production|staging>\n` +
        `Got: ${JSON.stringify(target)}\n`,
    );
    process.exit(2);
  }

  const required = MANIFESTS[target]!;
  const missing: VarSpec[] = [];
  for (const spec of required) {
    const value = process.env[spec.name];
    if (value === undefined || value === '') {
      missing.push(spec);
    }
  }

  if (missing.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`OK: ${required.length} required env vars present for target '${target}'`);
    process.exit(0);
  }

  process.stderr.write(`Missing ${missing.length} required env var(s) for target '${target}':\n`);
  for (const spec of missing) {
    process.stderr.write(`  - ${spec.name}\n    why: ${spec.reason}\n`);
  }
  process.exit(1);
}

main();
