import { securityHeaders } from '@repo/config/security/headers';
import { withSentryConfig } from '@sentry/nextjs';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
});

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001';
const isDev = process.env.NODE_ENV !== 'production';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui', '@repo/shared', '@repo/config', '@repo/i18n'],
  typedRoutes: false,
  eslint: {
    dirs: ['app', 'lib'],
  },
  async headers() {
    return securityHeaders({ apiOrigin, isDev });
  },
};

// Source-map upload runs at build time when `SENTRY_AUTH_TOKEN` is
// set (Vercel integration sets it on every deploy). Local builds
// without the token skip the upload + emit a no-op warning.
export default withSentryConfig(withSerwist(withNextIntl(config)), {
  org: process.env.SENTRY_ORG,
  project: 'bds-owner-web',
  silent: !process.env.CI,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: false },
  automaticVercelMonitors: false,
});
