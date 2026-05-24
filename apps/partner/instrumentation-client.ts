import * as Sentry from '@sentry/nextjs';

import { buildClientOptions } from '@repo/config/sentry';

// `instrumentation-client.ts` is loaded by Next.js + @sentry/nextjs on
// every page in the browser. No-ops when `NEXT_PUBLIC_SENTRY_DSN` is
// unset (local dev path).
//
// The shared helper returns a loose record so @repo/config doesn't
// depend on @sentry/nextjs; we hand it straight to Sentry.init which
// validates the shape at runtime.
Sentry.init(
  buildClientOptions({
    appRole: 'partner',
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    apiOrigin: process.env.NEXT_PUBLIC_API_URL,
  }),
);
