# Spec: Sentry on the four Next.js PWAs (phase 8.6)

> Status: **implemented**
> Phase: 8
> Owner: claude
> Spec last updated: 2026-05-22

## 1. Why

Phase 6.4 wired Sentry into the API (`@sentry/node`) but explicitly
**deferred** the four PWAs (admin, owner, tenant, partner) — they
have no error reporting yet, so a React crash, a fetch handler that
throws, or a `react-hook-form` resolver blowing up just shows the
user a blank screen and we never hear about it.

Phase 8.6 wires `@sentry/nextjs` into all four apps with per-app
DSNs so browser + server-component errors land in the same Sentry
org as the API events. Source-maps upload via the official Sentry
Vercel integration so stack traces are readable in production.

## 2. User stories

- As **on-call**, when a tenant's payment screen crashes I see the
  exception in Sentry within seconds, tagged with the user id, the
  route, and the release SHA — same dashboard I use for API errors.
- As an **operator triaging a bug report**, the breadcrumbs include
  the navigation history + the failing fetch call so I don't need
  the user to walk me through the steps.
- As a **developer**, locally `pnpm dev` still works without any
  Sentry env vars: the SDK detects the missing DSN, no-ops, and
  doesn't add noise to the console.
- As **security**, no PII (email, phone) is sent by default — the
  SDK runs with `sendDefaultPii: false` matching the API's
  `@sentry/node` config from 6.4.

## 3. Surfaces

| Surface                                                                                    | Notes                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each PWA's `instrumentation.ts`                                                            | Next 15's load hook. Calls into `@repo/config/sentry` to keep init logic single-sourced.                                                                                        |
| Each PWA's `sentry.client.config.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` | Stays at the app root because `@sentry/nextjs` finds them by path. Each delegates to the shared init helper.                                                                    |
| Each PWA's `next.config.ts`                                                                | Wrapped with `withSentryConfig` so the webpack plugin uploads source-maps at build time when `SENTRY_AUTH_TOKEN` is set.                                                        |
| `@repo/config/sentry`                                                                      | New module exporting `buildClientOptions({ appRole, dsn, release })` and `buildServerOptions(...)`. Centralizes sample rates, denylist, and PII flags.                          |
| Env vars                                                                                   | `NEXT_PUBLIC_SENTRY_DSN` (per-app), `SENTRY_RELEASE` (shared, optional), `SENTRY_AUTH_TOKEN` (build-time only — set on the Vercel integration), `SENTRY_ORG`, `SENTRY_PROJECT`. |

The API's own Sentry wiring (apps/api/src/observability/sentry.ts)
is **unchanged**. This slice is PWA-only.

## 4. Per-app DSN strategy

One Sentry project per role + environment. Project slugs land in
the Vercel integration:

| App     | Sentry project slug | Env var that holds the DSN |
| ------- | ------------------- | -------------------------- |
| admin   | `bds-admin-web`     | `NEXT_PUBLIC_SENTRY_DSN`   |
| owner   | `bds-owner-web`     | `NEXT_PUBLIC_SENTRY_DSN`   |
| tenant  | `bds-tenant-web`    | `NEXT_PUBLIC_SENTRY_DSN`   |
| partner | `bds-partner-web`   | `NEXT_PUBLIC_SENTRY_DSN`   |

Each app uses **the same env var name** (`NEXT_PUBLIC_SENTRY_DSN`)
but Vercel sets a different value per project. `@repo/config/sentry`
tags every event with `app_role` derived from `APP_ROLE` so
cross-project queries still join cleanly.

The `NEXT_PUBLIC_` prefix is required to expose the DSN to the
browser bundle. The DSN is **not** a secret in Sentry's threat
model — it identifies the project for ingestion only.

## 5. Files added per app

For `apps/<app>/`:

```
instrumentation.ts            -- server + edge init via runtime check
instrumentation-client.ts     -- browser init; top-level Sentry.init
next.config.ts                -- now ends in `withSentryConfig(config, {...})`
```

`@sentry/nextjs` v10 reads `instrumentation-client.ts` for the
browser bundle and the existing Next 15 `instrumentation.ts` hook
for the node/edge runtimes. The legacy three-file split
(`sentry.client.config.ts` / `sentry.server.config.ts` /
`sentry.edge.config.ts`) still works but is deprecated; we use the
newer two-file pattern.

## 6. Shared `@repo/config/sentry` API

```ts
// packages/config/sentry/index.ts (new)

export interface SentryAppContext {
  /** Free-form app label tagged on every event. Use the role slug. */
  appRole: 'admin' | 'owner' | 'tenant' | 'partner';
  /** From `process.env.NEXT_PUBLIC_SENTRY_DSN`. */
  dsn: string | undefined;
  /** From `process.env.NEXT_PUBLIC_SENTRY_RELEASE` (optional). */
  release?: string;
}

export function buildClientOptions(ctx: SentryAppContext): ClientOptions;
export function buildServerOptions(ctx: SentryAppContext): ServerOptions;
export function buildEdgeOptions(ctx: SentryAppContext): EdgeOptions;
```

All three set:

- `dsn: ctx.dsn` (undefined → SDK no-ops cleanly).
- `environment: process.env.NODE_ENV`.
- `release: ctx.release`.
- `sendDefaultPii: false`.
- `tracesSampleRate: 0.1` in production, `0` otherwise.
- `replaysSessionSampleRate: 0` (no Replay in v1; cost-conscious).
- `replaysOnErrorSampleRate: 0` (same; can enable later).
- Standard `denyUrls` excluding `/healthz` + service-worker fetches.

The client variant additionally:

- Adds the `BrowserTracing` integration with `tracePropagationTargets:
[apiUrl]` so XHR spans link to API traces.
- Filters out the common "ResizeObserver loop limit exceeded" noise
  via `ignoreErrors`.

## 7. `withSentryConfig` options

Per app:

```ts
export default withSentryConfig(withSerwist(config), {
  org: process.env.SENTRY_ORG,
  project: 'bds-<role>-web',
  silent: !process.env.CI,
  // Auth-token-driven source-map upload only when set. Local builds
  // (no token) just skip the upload step.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Hide source-maps from the browser bundle even though they're
  // uploaded to Sentry. The map files don't ship to clients.
  hideSourceMaps: true,
  // Suppress the SDK's "automatic Vercel cron monitor" instrumentation —
  // we don't run Vercel cron in this stack.
  automaticVercelMonitors: false,
});
```

## 8. Privacy

- `sendDefaultPii: false` — emails, IPs, cookies are not attached.
- `beforeSend` strips `Authorization` and `Cookie` headers from any
  fetch breadcrumb that slips through.
- User context is set to `{ id }` only when the actor is
  authenticated; no name / email.

## 9. Out of scope

- **Session Replay** (Sentry feature). Opt-in via a future env flag
  when there's a clear support need.
- **Custom transactions / business-metric spans**. The SDK's
  defaults capture pageviews + xhr; bespoke transactions land
  per-feature when ops asks.
- **API Sentry rework**: 8.6 keeps `apps/api/src/observability/sentry.ts`
  untouched. The two surfaces are intentionally independent so a
  prod outage in one doesn't take the other down.
- **Per-route DSN overrides**, `serverActions` spans, anything not
  documented in §6.

## 10. Acceptance criteria

- [ ] `@sentry/nextjs` listed as a dep in each of the four PWAs at a
      single shared version.
- [ ] Each app has `sentry.client.config.ts`, `sentry.server.config.ts`,
      `sentry.edge.config.ts`, and `instrumentation.ts`.
- [ ] Each `next.config.ts` is wrapped with `withSentryConfig`.
- [ ] `@repo/config/sentry` exports the three option-builders.
- [ ] `pnpm turbo typecheck` clean.
- [ ] `pnpm turbo lint` clean.
- [ ] `pnpm turbo build` clean (Sentry's webpack plugin runs without
      `SENTRY_AUTH_TOKEN` and warns but doesn't fail).
- [ ] When `NEXT_PUBLIC_SENTRY_DSN` is unset, the app boots without
      any console error (SDK no-ops).

## 11. Manual test plan

1. Set `NEXT_PUBLIC_SENTRY_DSN` to a Sentry test project DSN in
   `apps/tenant/.env.local`.
2. `pnpm --filter @repo/tenant dev`, open `http://localhost:4020`,
   add `throw new Error('phase8.6 sentry smoke');` to the homepage,
   refresh.
3. Check the Sentry test project: event appears with tag
   `app_role: tenant`, breadcrumbs include the page nav.
4. Remove the throw + the DSN; restart the app; verify the console
   stays clean.

## 12. Rollout

- No DB migration.
- No feature flag.
- Vercel deploy reads `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`,
  `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_RELEASE` from the
  Sentry Vercel integration; no code change needed once the
  integration is installed on the four projects.
- Local devs see no behavior change since the DSN env vars are
  unset by default.
