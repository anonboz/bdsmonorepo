/**
 * Shared PostHog option builders for the four Next.js PWAs.
 *
 * Each app's `_components/analytics-provider.tsx` calls into here so
 * the property-blacklist, persistence model, and `app_role` register
 * tag live in one place. Per-app variance is the role string + the
 * `NEXT_PUBLIC_POSTHOG_KEY` Vercel injects per project.
 *
 * When `apiKey` is undefined, the provider component skips
 * `posthog.init` entirely — the SDK never loads, no network calls.
 *
 * Type signatures stay structural so this package keeps its
 * runtime-dep-free posture; consumers cast to the SDK's own types
 * at the call site.
 */

export type AnalyticsAppRole = 'admin' | 'owner' | 'tenant' | 'partner';

export interface AnalyticsAppContext {
  appRole: AnalyticsAppRole;
  apiKey: string | undefined;
  apiHost?: string;
}

/**
 * Loose option-bag — passed straight to `posthog.init(key, options)`.
 * Matches the subset of `posthog-js`'s `Config` we actually care
 * about; the SDK ignores anything extra.
 */
export interface PostHogClientOptions {
  api_host: string;
  capture_pageview: boolean;
  capture_pageleave: boolean;
  persistence: 'localStorage+cookie' | 'cookie' | 'localStorage' | 'memory';
  property_blacklist: string[];
  autocapture: boolean;
  disable_session_recording: boolean;
}

/**
 * The default Vercel-hosted region. PostHog Cloud users on the EU
 * tier should set `NEXT_PUBLIC_POSTHOG_HOST` to `https://eu.i.posthog.com`.
 */
export const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

const PII_PROPERTY_BLACKLIST: readonly string[] = [
  // IP-derived fields. PostHog can geolocate us via these; we don't
  // need or want it in v1.
  '$ip',
  '$geoip_city_name',
  '$geoip_country_name',
  '$geoip_country_code',
  '$geoip_subdivision_1_name',
  '$geoip_subdivision_1_code',
  '$geoip_postal_code',
  '$geoip_latitude',
  '$geoip_longitude',
  // Common form-field names autocapture sometimes picks up.
  'email',
  'phone',
  'password',
  'displayName',
];

export function buildPostHogOptions(ctx: AnalyticsAppContext): PostHogClientOptions {
  return {
    api_host: ctx.apiHost ?? DEFAULT_POSTHOG_HOST,
    // We capture pageviews + leaves manually from the provider's
    // `usePathname` effect so SPA navigations are tracked. Disable
    // the SDK's defaults to avoid double-counting.
    capture_pageview: false,
    capture_pageleave: false,
    persistence: 'localStorage+cookie',
    property_blacklist: [...PII_PROPERTY_BLACKLIST],
    // Autocapture is off in v1 — it bloats event volume and we don't
    // have a use case yet. Flip on later if PM asks.
    autocapture: false,
    // Session Replay opt-in lands later via a feature flag.
    disable_session_recording: true,
  };
}

/**
 * Register-properties for the SDK's `posthog.register({...})` call.
 * Tagged on every subsequent event so PostHog filters can slice by
 * role without joining person properties.
 */
export function buildRegisterProperties(ctx: AnalyticsAppContext): Record<string, unknown> {
  return { app_role: ctx.appRole };
}
