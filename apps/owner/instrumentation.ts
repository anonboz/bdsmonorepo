/**
 * Server + edge runtime Sentry init. Called once per Next.js process
 * via the framework's `register()` hook. The matching client init
 * lives in `instrumentation-client.ts`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs');
    const { buildServerOptions } = await import('@repo/config/sentry');
    Sentry.init(
      buildServerOptions({
        appRole: 'owner',
        dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
        release: process.env.SENTRY_RELEASE,
      }) as Parameters<typeof Sentry.init>[0],
    );
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs');
    const { buildEdgeOptions } = await import('@repo/config/sentry');
    Sentry.init(
      buildEdgeOptions({
        appRole: 'owner',
        dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
        release: process.env.SENTRY_RELEASE,
      }) as Parameters<typeof Sentry.init>[0],
    );
  }
}

// Re-export the Sentry router-transition hook so client-side navigation
// errors get captured. The SDK looks for this named export.
export { captureRouterTransitionStart as onRouterTransitionStart } from '@sentry/nextjs';
