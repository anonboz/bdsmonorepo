/**
 * Shared security-headers preset for the four Next.js PWAs.
 *
 * Returns a value compatible with Next's `headers()` config — every
 * route gets HSTS, X-Frame-Options DENY, a tight CSP, Referrer-Policy,
 * and a restrictive Permissions-Policy.
 *
 * Why this package owns it: the four apps would otherwise drift on
 * what they ship. A single source means one change touches all four.
 *
 * CSP notes:
 *   - `'unsafe-inline'` for scripts is forced by Next.js's inline
 *     hydration bootstrap. Nonces (the proper fix) need a custom
 *     middleware streaming a nonce into the HTML — a known-good
 *     follow-up. Until then `'unsafe-inline'` stays.
 *   - `'unsafe-eval'` is added only in dev (HMR + React DevTools).
 *   - `img-src` is permissive (`https:`) because campaign / proof
 *     photos may come from S3 / Vercel Blob / arbitrary hosts in
 *     pre-production. Tighten when storage lands.
 *   - `connect-src` includes the API origin so the typed client can
 *     reach `/v1/*`.
 */
export interface SecurityHeadersOptions {
  /** Absolute origin of the API (e.g. `http://localhost:4001`). */
  apiOrigin: string;
  /** Loosen CSP for HMR + React DevTools when running `next dev`. */
  isDev: boolean;
  /**
   * Extra `connect-src` origins (Sentry, PostHog, etc.). Joined with
   * the API origin and `'self'`.
   */
  extraConnectSrc?: string[];
}

export interface NextHeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

const STATIC_HEADERS: { key: string; value: string }[] = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

export function buildContentSecurityPolicy(opts: SecurityHeadersOptions): string {
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (opts.isDev) scriptSrc.push("'unsafe-eval'");

  const connectSrc = ["'self'", opts.apiOrigin, ...(opts.extraConnectSrc ?? [])];
  if (opts.isDev) {
    // Next dev HMR uses websockets to the dev server's own origin —
    // 'self' covers both http/https/ws/wss for the served origin.
    connectSrc.push('ws:', 'wss:');
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': scriptSrc,
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': connectSrc,
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
  };

  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export function securityHeaders(opts: SecurityHeadersOptions): NextHeaderRule[] {
  return [
    {
      // Catch-all path — Next applies these to every route, including
      // static assets. Same headers everywhere is the desired posture.
      source: '/(.*)',
      headers: [
        ...STATIC_HEADERS,
        { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(opts) },
      ],
    },
  ];
}
