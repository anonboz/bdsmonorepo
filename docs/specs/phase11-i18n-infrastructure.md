# Spec: i18n infrastructure (phase 11.1)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

The four PWAs ship English-only today. Phase 11 is a Vietnamese-
first re-positioning, and 11.3/11.4 will do the bulk of string
extraction across the apps. Before that work can start, the
infrastructure has to be in place — a single library, a single
catalog layout, a single way to read/write the user's chosen
locale, and a single source of truth for "what locales does this
platform support."

11.1 builds that scaffolding. Zero user-facing copy changes ship
in this slice; the goal is a green-pipeline plumbing pass that
later slices can plug strings into.

## 2. User stories

- As a **developer adding a Vietnamese translation**, I import
  `useTranslations` from `@repo/i18n` (or from `next-intl` directly)
  and add a key to the right namespace under
  `packages/i18n/src/messages/{en,vi}/<namespace>.json`. The
  smoke-test catalog already proves the wiring works.
- As a **user**, I can flip between languages via a small switcher
  component. The choice persists across navigations (cookie) and
  across sessions (server-stamped onto `User.locale` in 11.2).
- As **ops**, the deploy pipeline doesn't change. No new env vars
  in 11.1 — the locale config is compile-time in the new package.

## 3. Surfaces

| Surface              | App / file                                                             | Notes                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package              | `packages/i18n/` (new)                                                 | Config, server/client helpers, message catalogs, locale switcher.                                                                                     |
| Tenant wiring        | `apps/tenant/{i18n.ts,middleware.ts,app/layout.tsx,next.config.ts}`    | next-intl plugin + server request loader + provider wrap + cookie middleware.                                                                         |
| Owner wiring         | `apps/owner/...`                                                       | Same shape as tenant.                                                                                                                                 |
| Partner wiring       | `apps/partner/...`                                                     | Same shape as tenant.                                                                                                                                 |
| Admin wiring         | `apps/admin/...`                                                       | Same shape, but Phase 11.4 documents the English-only carve-out — the wiring is still in place so it's a config flip later if support ever localizes. |
| Per-PWA package.json | `@repo/i18n` workspace dep + `next-intl` added through the new package | One install, four consumers.                                                                                                                          |

## 4. Locale model

```ts
// packages/i18n/src/config.ts
export const locales = ['vi', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'vi';

/** Name of the cookie that pins the user's choice across requests. */
export const LOCALE_COOKIE = 'bds-locale';
```

**No URL prefix routing in v1.** The four PWAs keep their existing
route trees (`/`, `/me`, `/my-bills`, …) — locale is detected
from:

1. The `LOCALE_COOKIE` cookie if present.
2. The first matching locale in `Accept-Language` otherwise.
3. `defaultLocale` (vi) as last resort.

URL-prefix routing (e.g. `/en/me`) is on the roadmap for a future
SEO-polish slice when the public marketing surface needs it, but
the v1 user base is authenticated B2B — cookie + header is enough.

The cookie is set client-side by the locale switcher + server-side
by Phase 11.2 when a logged-in user flips their `User.locale`.

## 5. `@repo/i18n` package layout

```
packages/i18n/
├── package.json                       # exports + workspace dep on next-intl
├── tsconfig.json
├── CLAUDE.md
└── src/
    ├── index.ts                       # barrel: config, helpers, components
    ├── config.ts                      # locales, defaultLocale, cookie name
    ├── server.ts                      # getLocaleFromRequest, getMessagesFor
    ├── client.tsx                     # <I18nProvider locale messages> wrapper
    ├── middleware.ts                  # locale-cookie helper for app middleware
    ├── components/
    │   └── locale-switcher.tsx        # vanilla Tailwind, no @repo/ui dep
    └── messages/
        ├── en/
        │   └── common.json            # smoke-test strings (greeting, app name)
        └── vi/
            └── common.json
```

The package is leaf (no dependency on `@repo/ui` or any app code),
so all four PWAs can pull it in without circular pain.

Exports:

```ts
// packages/i18n/src/index.ts
export { locales, defaultLocale, type Locale, LOCALE_COOKIE, isLocale } from './config';
export { getLocaleFromRequest, getMessagesFor } from './server';
export { I18nProvider } from './client';
export { localeMiddleware } from './middleware';
export { LocaleSwitcher } from './components/locale-switcher';
```

`next-intl`'s `useTranslations` / `getTranslations` are imported
directly from `next-intl` in consumers — we don't re-export the
whole library, just the platform-specific config.

## 6. Per-PWA wiring

Each app gets four touch points:

### 6.1 `next.config.ts`

Wrap the existing config with `withNextIntl()` so the plugin
hooks into the build:

```ts
import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./i18n.ts');
export default withSentryConfig(withSerwist(withNextIntl(config)), ...);
```

### 6.2 `i18n.ts` at app root

Next-intl reads this on each request to know which locale +
which messages to load.

```ts
import { getRequestConfig } from 'next-intl/server';
import { getLocaleFromRequest, getMessagesFor } from '@repo/i18n';

export default getRequestConfig(async () => {
  const locale = await getLocaleFromRequest();
  return { locale, messages: await getMessagesFor(locale) };
});
```

### 6.3 `middleware.ts`

Reads `Accept-Language` on first visit + stamps the cookie if
absent. Existing middleware logic (trace id) stays; we add a
small helper from `@repo/i18n`:

```ts
import { localeMiddleware } from '@repo/i18n';
export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  localeMiddleware(req, res);
  // ...existing trace-id logic
  return res;
}
```

### 6.4 `app/layout.tsx`

Server-component layout wraps children in the next-intl client
provider + sets `<html lang>` dynamically:

```tsx
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

The `lang={locale}` attribute is the load-bearing accessibility
change — screen readers + browsers now know what language the
page is in.

## 7. Smoke-test strings

11.1 ships a single string per app (e.g. the app title) routed
through `useTranslations()` as proof that the pipeline works
end-to-end. Phase 11.3 / 11.4 do the bulk extraction.

```ts
// packages/i18n/src/messages/en/common.json
{
  "appName": {
    "tenant": "BDS Tenant",
    "owner": "BDS Owner",
    "partner": "BDS Partner",
    "admin": "BDS Admin"
  }
}
```

Vietnamese equivalent in `vi/common.json`. Each PWA's `metadata.title`

- a header label uses `useTranslations('common').`raw('appName.<role>')``.

## 8. Permissions

None — i18n is a presentation layer concern.

## 9. Edge cases

- **`Accept-Language` reports an unsupported locale**: `getLocaleFromRequest` falls back to `defaultLocale` (vi). No 4xx; we never block a request on locale negotiation.
- **Cookie carries a stale value (e.g. `de`)**: same fallback. The locale switcher only writes values from the canonical list.
- **Service worker pre-cached pages**: the SW caches by URL; with cookie-only routing, the same URL renders the user's current locale. If a user flips locale on an offline-cached page they'll see the previous render until the next online fetch. Acceptable for v1.
- **PostHog events**: keys stay English (stable IDs). User-facing event names aren't displayed; no localization needed.
- **Email + push templates**: out of scope for 11.1. Phase 11.5 picks up the recipient-side localization.

## 10. Out of scope

- **String extraction** of existing app copy. Phase 11.3 (tenant) + 11.4 (owner / partner / admin) do that.
- **`User.locale` server persistence.** Phase 11.2 adds the column + the `PATCH /me` endpoint. Until then the cookie is the source of truth.
- **Locale-aware money + date helpers.** Phase 11.7. Existing `formatMoney` / `formatDateTime` stay as-is for this slice.
- **URL-prefix routing** (`/en/…`). Future polish; current routing untouched.
- **RTL layouts** — Vietnamese + English are both LTR; no work needed.

## 11. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` clean across all four PWAs.
- [ ] `pnpm --filter @repo/i18n typecheck` clean.
- [ ] Each PWA boots in development; visiting `/` with `Accept-Language: vi` shows the Vietnamese smoke-test string; with `Accept-Language: en` shows English.
- [ ] Setting the `bds-locale` cookie explicitly overrides `Accept-Language`.
- [ ] `<html lang>` reflects the active locale.
- [ ] The locale switcher component flips the cookie + reloads the page.
- [ ] No existing user-facing copy regresses (all hard-coded strings still render as English).

## 12. Manual test plan

1. `pnpm install` to pick up the new `next-intl` dep.
2. `pnpm turbo dev` — all four PWAs boot.
3. In each app, open DevTools, set `Accept-Language: vi`, hard-reload. The single smoke-test string shows Vietnamese.
4. Click the locale switcher to flip back to English. The cookie is set; refresh shows English persistently.
5. Delete the cookie, set `Accept-Language: ja-JP, en-US;q=0.9` — falls back to `en` (first supported).
6. Delete the cookie + clear Accept-Language — defaults to `vi`.

## 13. Rollout

- New `packages/i18n` workspace package; no migration, no env vars.
- `next-intl` added as a direct dep of `@repo/i18n`. PWAs pull it transitively.
- No feature flag — the wiring is invisible to users until 11.3+ ships translated strings.
