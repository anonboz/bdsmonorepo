import { securityHeaders } from '@repo/config/security/headers';
import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
});

const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const isDev = process.env.NODE_ENV !== 'production';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@repo/ui', '@repo/shared', '@repo/config'],
  typedRoutes: false,
  eslint: {
    dirs: ['app', 'lib'],
  },
  async headers() {
    return securityHeaders({ apiOrigin, isDev });
  },
};

export default withSerwist(config);
