import { PostHog } from 'posthog-node';

import { env } from '../../env.js';

/**
 * Module-level PostHog singleton. Mirrors the `getMailer()` pattern
 * in `mailer.client.ts` — code that runs outside Nest's DI graph
 * (better-auth hooks, one-off scripts) can capture events without
 * dragging the container in. The Nest-DI face is `AnalyticsService`
 * which delegates here.
 *
 * Returns `null` when `POSTHOG_KEY` is unset, so every caller can
 * `getPostHog()?.capture(...)` without a separate enabled-check.
 */

let cached: PostHog | null | undefined;

export function getPostHog(): PostHog | null {
  if (cached !== undefined) return cached;
  if (!env.POSTHOG_KEY) {
    cached = null;
    return null;
  }
  cached = new PostHog(env.POSTHOG_KEY, {
    host: env.POSTHOG_HOST,
    flushAt: 20,
    flushInterval: 10_000,
  });
  return cached;
}

/**
 * Test-only escape hatch. Lets specs swap in a stub client (or reset
 * to `undefined` so the next `getPostHog()` re-reads env). Should
 * never be called from production code.
 */
export function setPostHogForTests(client: PostHog | null | undefined): void {
  cached = client;
}
