/**
 * Shared Sentry option builders for the four Next.js PWAs.
 *
 * Each app's `sentry.client.config.ts` / `sentry.server.config.ts` /
 * `sentry.edge.config.ts` calls into here so the sample rates, deny
 * lists, PII flags, and tag set live in one place. Per-app variance
 * is the `appRole` tag (and the DSN env var which Vercel sets to a
 * different value per project).
 *
 * When `dsn` is undefined the SDK's `init({ dsn: undefined })`
 * no-ops cleanly. That's the dev-without-DSN path — no console
 * noise, no network calls.
 *
 * Type signatures are kept structural (we don't depend on
 * `@sentry/nextjs` at type-check time) so this package stays
 * runtime-dep-free for the toolchain.
 */

export type SentryAppRole = 'admin' | 'owner' | 'tenant' | 'partner';

export interface SentryAppContext {
  appRole: SentryAppRole;
  dsn: string | undefined;
  release?: string;
  /** Forwarded to BrowserTracing's `tracePropagationTargets`. Lets
   *  the SDK link client XHRs to API spans by tagging the
   *  outbound `sentry-trace` header. Falls back to none when unset. */
  apiOrigin?: string;
}

/**
 * Loosely-typed option bag — we return a plain record so this
 * package doesn't need to depend on `@sentry/nextjs` for type
 * compatibility. Consumer call sites pass the result straight into
 * `Sentry.init(...)`; the SDK type-checks the shape internally.
 */
type BaseOptions = Record<string, unknown>;

const COMMON_IGNORE_ERRORS: readonly string[] = [
  // Chromium's harmless layout-loop warning that shows up as an error
  // in the browser SDK. Has zero diagnostic value and floods the inbox.
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications.',
  // Network blips from a tab going offline mid-request.
  'NetworkError when attempting to fetch resource.',
  'Failed to fetch',
];

const COMMON_DENY_URLS: readonly RegExp[] = [
  // Don't track service-worker registrations.
  /\/sw\.js$/i,
  // Health endpoints are infrastructure noise, not user-facing errors.
  /\/healthz$/i,
  /\/readyz$/i,
];

function tracesSampleRate(): number {
  return process.env.NODE_ENV === 'production' ? 0.1 : 0;
}

function baseOptions(ctx: SentryAppContext): BaseOptions {
  return {
    dsn: ctx.dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: ctx.release,
    sendDefaultPii: false,
    tracesSampleRate: tracesSampleRate(),
    initialScope: {
      tags: { app_role: ctx.appRole },
    },
    beforeSend(event: { request?: { headers?: Record<string, unknown> } }) {
      // Strip auth-bearing headers from any breadcrumb that snuck
      // them in. Sentry's defaults usually omit these, but defending
      // against future SDK changes is cheap.
      const headers = event.request?.headers;
      if (headers) {
        delete headers['authorization'];
        delete headers['cookie'];
        delete headers['Authorization'];
        delete headers['Cookie'];
      }
      return event;
    },
  };
}

export function buildClientOptions(ctx: SentryAppContext): BaseOptions {
  return {
    ...baseOptions(ctx),
    tracePropagationTargets: ctx.apiOrigin ? [ctx.apiOrigin] : [],
    ignoreErrors: [...COMMON_IGNORE_ERRORS],
    denyUrls: [...COMMON_DENY_URLS],
    // Replay is opt-in later — keep it off for v1 to control bundle
    // size + ingest cost.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  };
}

export function buildServerOptions(ctx: SentryAppContext): BaseOptions {
  return baseOptions(ctx);
}

export function buildEdgeOptions(ctx: SentryAppContext): BaseOptions {
  return baseOptions(ctx);
}
