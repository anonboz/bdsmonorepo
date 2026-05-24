# CLAUDE.md — @repo/i18n

Localization config + helpers shared across the four PWAs. Phase 11.

## Rules

- **Leaf package.** No dependencies on `@repo/ui`, app code, or anything that
  could form an import cycle. The four PWAs all consume this directly.
- **`next-intl` lives here.** PWAs import `useTranslations` etc. from
  `next-intl` for component-level use, but the wiring (request config,
  middleware, cookie name) lives in this package so all four apps stay in
  sync.
- **JSON catalogs.** Strings live under `src/messages/<locale>/<namespace>.json`.
  Add a new namespace by dropping a JSON file in both `en/` + `vi/`; consumers
  call `useTranslations('<namespace>')`.
- **Locale shape pinned.** The canonical set is `vi` + `en`. Adding a third
  language means appending to `config.ts` + creating the messages directory;
  every consumer picks it up automatically through `getMessagesFor`.
- **No URL prefix routing.** Locale is cookie + `Accept-Language` only. See
  `docs/specs/phase11-i18n-infrastructure.md` §4 for the rationale.

## Per-PWA wiring checklist

All four PWAs must carry identical plumbing — diverging silently makes
server-rendered translations fall back to raw keys for that app:

- `withNextIntl()` wraps the export in `next.config.ts`
- `i18n.ts` at the project root exports `getRequestConfig`
- The existing `middleware.ts` calls `localeMiddleware`
- An async root layout wraps children in `<I18nProvider>` with
  `<html lang={locale}>`

## When to add a string

A user-facing label / button / error message. Avoid keys for purely structural
text (e.g. component-internal aria attributes that aren't displayed) — those
stay inline.

## When NOT to use this package

- API responses. The backend stays English internally; localization happens
  on the client. Notification email bodies are localized server-side in 11.5
  via a separate template-renderer path.
- Database content (campaign descriptions, ticket bodies). These are
  user-generated and stay in the language the author wrote them.

## Entrypoints

Two public surfaces, so a client component never accidentally drags
`next/headers` into the browser bundle:

- `@repo/i18n` — config, `LocaleSwitcher`, `I18nProvider`,
  `localeMiddleware`, types. Safe in client + server components.
- `@repo/i18n/server` — `getLocaleFromRequest`, `getMessagesFor`.
  Server-only; importing into a client component is a webpack error
  by design.

Per-PWA `i18n.ts` (the next-intl request-config hook) is the canonical
caller of the `/server` entrypoint.

## Layout

```
src/
├── config.ts                  # locales, defaultLocale, cookie name
├── server.ts                  # request-time loader (Next.js cookies/headers)
├── client.tsx                 # <I18nProvider> wrapping NextIntlClientProvider
├── middleware.ts              # cookie helper for app middleware
├── components/
│   └── locale-switcher.tsx    # vanilla Tailwind switcher
├── messages/
│   ├── en/<namespace>.json
│   └── vi/<namespace>.json
└── index.ts                   # client-safe barrel
```
