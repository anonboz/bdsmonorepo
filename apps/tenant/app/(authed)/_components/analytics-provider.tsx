'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  DEFAULT_POSTHOG_HOST,
  buildPostHogOptions,
  buildRegisterProperties,
} from '@repo/config/analytics';

const APP_ROLE = 'tenant';

/**
 * PostHog client-side wiring. Mounts in the `(authed)` layout so we
 * only init once we know the user has a session. No-ops cleanly when
 * `NEXT_PUBLIC_POSTHOG_KEY` is unset (local dev path).
 *
 * Captures:
 *   - `user.signed_in` once on first mount per session.
 *   - `$pageview` on every SPA navigation (manual, since the SDK's
 *     auto-pageview doesn't follow App Router navigations cleanly).
 */
export function AnalyticsProvider({ userId, roles }: { userId: string; roles: string[] }) {
  const initialized = useRef(false);
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (initialized.current) return;
    const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!apiKey) return;
    const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
    let cancelled = false;
    void (async () => {
      // Dynamic import so the SDK doesn't ship on routes that never
      // mount the provider (login, /forbidden, /offline).
      const posthogMod = await import('posthog-js');
      if (cancelled) return;
      const posthog = posthogMod.default;
      posthog.init(apiKey, buildPostHogOptions({ appRole: APP_ROLE, apiKey, apiHost }));
      posthog.register(buildRegisterProperties({ appRole: APP_ROLE, apiKey }));
      posthog.identify(userId, { role: roles });
      posthog.capture('user.signed_in', { role: roles });
      initialized.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, roles]);

  useEffect(() => {
    if (!initialized.current) return;
    if (typeof window === 'undefined') return;
    void (async () => {
      const posthogMod = await import('posthog-js');
      const posthog = posthogMod.default;
      const url =
        window.location.origin +
        (pathname ?? '/') +
        (search?.toString() ? `?${search.toString()}` : '');
      posthog.capture('$pageview', { $current_url: url });
    })();
  }, [pathname, search]);

  return null;
}
