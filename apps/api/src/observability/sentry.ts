import * as Sentry from '@sentry/node';

import { env } from '../env.js';

let initialized = false;

/**
 * Initialize Sentry once per process. Safe to call from `main.ts`
 * unconditionally — when `SENTRY_DSN` is unset, this is a no-op and
 * `isSentryEnabled()` returns false so callers can branch.
 *
 * Init must happen BEFORE `NestFactory.create` so Sentry's auto-instrumentation
 * patches Node internals (fs, http) ahead of any other module loading. See
 * https://docs.sentry.io/platforms/node/install/.
 */
export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // 10% trace sampling in prod, 0 in dev/test (avoids local noise).
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 0,
    release: env.SENTRY_RELEASE,
    // Request bodies + cookies may contain PII (emails, OTPs); leave off.
    sendDefaultPii: false,
  });
  initialized = true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export interface SentryCaptureContext {
  traceId?: string | null;
  actorId?: string | null;
  path?: string | null;
}

/**
 * Forwards an exception to Sentry with our standard tag set. Cheap
 * no-op when Sentry isn't initialized so callers don't need to guard.
 */
export function captureException(error: unknown, ctx: SentryCaptureContext = {}): void {
  if (!initialized) return;
  Sentry.captureException(error, (scope) => {
    if (ctx.traceId) scope.setTag('traceId', ctx.traceId);
    if (ctx.actorId) scope.setUser({ id: ctx.actorId });
    if (ctx.path) scope.setTag('path', ctx.path);
    return scope;
  });
}
