# Spec: Tenant PWA localization — slice A (phase 11.3a)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 11.1 wired the i18n infrastructure; 11.2 made `User.locale` the
server-side source of truth. Neither slice translated a single
user-facing string. 11.3 takes the tenant PWA from English-only to
Vietnamese-default + English-opt-in — the highest-traffic surface
goes first per BUILD_PLAN §5.3 so we catch translation-quality
issues before they cascade to owner / partner.

**Slice A** (this PR) covers the chrome + auth surface: layout
metadata, login, landing tiles, account / language preference, the
forbidden page, the offline page, the public undo-email page, and
the locale-switcher placement. The "everything else" tenant pages
(my-bills, my-leases, my-tickets, notifications, browse, applications,
ratings) ship in slice B as a follow-up so reviewers see a
focused diff per PR.

## 2. User stories

- As a **first-time Vietnamese visitor** landing on `/login`, every
  string renders in Vietnamese without me touching anything.
- As a **logged-in user**, I open `/me` and flip the language
  switcher to English; `User.locale` updates, the cookie updates,
  and the next page render is English.
- As an **anonymous visitor** on `/login`, the language switcher
  works even though there's no session — it only writes the cookie
  and reloads.

## 3. Surfaces

| Surface              | App / file                                                        | Notes                                                                                     |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Catalog              | `packages/i18n/src/messages/{en,vi}/tenant.json`                  | New namespace `tenant.*` keyed under sub-domains (`login`, `home`, `account`, …).         |
| i18n loader          | `packages/i18n/src/server.ts`                                     | Adds tenant to the bundled catalogs so `useTranslations('tenant.*')` resolves.            |
| Entrypoint split     | `packages/i18n/package.json`, `packages/i18n/src/index.ts`        | `@repo/i18n` (client-safe) vs `@repo/i18n/server` (cookies/headers).                      |
| Layout metadata      | `apps/tenant/app/layout.tsx`                                      | `generateMetadata()` uses `getTranslations('tenant')` for the description.                |
| Login                | `apps/tenant/app/login/{page,login-form}.tsx`                     | All static text extracted; switcher placed in the page header.                            |
| Landing              | `apps/tenant/app/(authed)/page.tsx`                               | Six tiles + "Coming soon" card extracted, `signedInAs` uses `t.rich` for the bolded name. |
| Account              | `apps/tenant/app/(authed)/me/page.tsx` + `language-card.tsx`      | New `LanguageCard` wires the switcher to `PATCH /v1/me` via the 11.2 endpoint.            |
| Delete-account card  | `apps/tenant/app/(authed)/me/_components/delete-account-card.tsx` | Three visual states + all error copy localized.                                           |
| Notification bell    | `apps/tenant/app/(authed)/_components/notification-bell-link.tsx` | `aria-label` localized; takes a plural-ish split between "Notifications" / "…N unread".   |
| Forbidden            | `apps/tenant/app/forbidden/page.tsx`                              | Role-mismatch copy localized; `{role}`+`{appName}` interpolated.                          |
| Offline              | `apps/tenant/app/offline/page.tsx`                                | Client component (needs `window.location.reload`); single retry button.                   |
| Erase-cancel landing | `apps/tenant/app/account/erase-cancel/page.tsx`                   | Public undo page (no auth); three shells localized.                                       |
| Playwright           | `apps/e2e/tests/web/tenant-locale-switcher.spec.ts`               | New `tenant-web` project boots the tenant dev server + verifies the vi → en flip.         |

## 4. Catalog layout

```
packages/i18n/src/messages/
├── en/
│   ├── common.json   ← appName, localeSwitcher (unchanged from 11.1)
│   └── tenant.json   ← NEW: login, home, account, forbidden, offline, eraseCancel, chrome
└── vi/
    ├── common.json   ← unchanged
    └── tenant.json   ← NEW: Vietnamese translations for all the above
```

Top-level keys mirror page slugs so a developer can find a string by
URL: `tenant.login.form.sendCode`, `tenant.account.delete.cancelButton`,
etc. ICU interpolation handles `{name}` / `{count}` / `{role}` /
`{appName}`. Rich-text (bolded name on the landing page, bolded
email on the OTP step) uses `t.rich` with a `strong` tag renderer at
the call-site — no HTML in the JSON.

## 5. Entrypoint split

Phase 11.1's `@repo/i18n` barrel re-exported `getLocaleFromRequest` +
`getMessagesFor` from `./server.ts`. Those helpers import `next/headers`,
which is server-only — pulling them into a client component
(`LanguageCard` here) failed the production build with a "needs
next/headers" error.

11.3 splits the public surface:

- `@repo/i18n` — `config`, `LocaleSwitcher`, `I18nProvider`,
  `localeMiddleware`, types. Safe in client + server.
- `@repo/i18n/server` — `getLocaleFromRequest`, `getMessagesFor`.
  Server-only.

The four PWAs' `i18n.ts` files (the next-intl request-config hook) now
import from `@repo/i18n/server`. The pre-login page (a server
component) also uses the `/server` entrypoint; everything else uses
the main barrel.

## 6. Locale switcher placement

Two surfaces in slice A:

- **`/login`** (anonymous) — switcher in the top-right of the page,
  no `onSave` callback (cookie-only).
- **`/me`** (authenticated) — a dedicated `LanguageCard` between the
  page header and the delete-account card, with `onSave` wired to
  `api.patch('/v1/me', { locale })`.

A persistent header-level switcher is intentionally not added in
slice A — the (authed) layout has no chrome to anchor it, and adding
chrome here would entangle this PR with a layout redesign.
Slice B revisits placement when it touches the per-page headers.

## 7. Vietnamese translations

All strings translated by the author. Conventions:

- App brand (`BDS`) stays as-is; role suffix translates: "BDS
  Người thuê" for Vietnamese, "BDS Tenant" for English.
- Buttons stay imperative ("Gửi mã" / "Send code", "Mở" / "Open").
- Error copy is full-sentence with a final period ("Mã không hợp lệ.").
- Timestamps render via `toLocaleString()` which already respects the
  browser locale — no extra wiring here. Phase 11.7 promotes
  `formatMoney`/`formatDateTime` to a shared helper so per-locale
  date formats are centralized.

## 8. Out of scope

- **`my-bills`, `my-leases`, `my-tickets`, `notifications`, `browse`,
  `applications`, `ratings`** — slice B. The relevant tenant
  catalogs gain sub-namespaces (`tenant.bills.*`, etc.) when those
  pages get extracted.
- **Owner / partner / admin PWAs** — Phase 11.4.
- **Email + push templates** — Phase 11.5.
- **`Intl.NumberFormat` / locale-aware date helpers** — Phase 11.7.
- **Persistent header-level switcher in (authed) layout** — slice B
  or a layout-refresh follow-up.

## 9. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `pnpm --filter @repo/tenant build` succeeds (catches the
      client-component / `next/headers` boundary).
- [ ] Visiting `/login` with no cookie + `Accept-Language: vi` renders
      every string in Vietnamese.
- [ ] Flipping the switcher to English re-renders the login page in
      English; the `bds-locale` cookie persists across refresh.
- [ ] Authenticated user on `/me` can use the LanguageCard to flip
      `User.locale`; the next `/v1/me` returns the new value.
- [ ] The `tenant-web` Playwright project boots the dev server and
      the new spec passes.

## 10. Manual test plan

1. `pnpm turbo dev` — API + tenant.
2. Clear cookies. Open `http://localhost:3020/login` with the
   browser language set to Vietnamese (or any unknown locale): the
   default locale should be Vietnamese, all strings localized.
3. Pick "English" in the top-right switcher — page reloads in
   English. Refresh: still English.
4. Log in (any seeded tenant email). Open `/me`. Confirm the
   `LanguageCard` is between the header and the delete-account card.
5. Flip to Vietnamese inside `/me`. Confirm `/v1/me` returns
   `user.locale: "vi"` (DevTools → Network).
6. Trigger `/forbidden` (e.g., log in as a non-tenant role): copy
   should be localized.
7. Stop the API: `/offline` should render localized; click "Thử lại"
   / "Retry" to reload.

## 11. Rollout

- No migrations.
- No env vars.
- No feature flag — language defaults to Vietnamese for all users
  immediately. Existing rows already carry `locale = 'vi'` from the
  11.2 default, so logged-in users see Vietnamese on their next
  visit unless they explicitly flip.
- The Playwright `tenant-web` project boots the tenant dev server
  in addition to the API; CI cost grows by one Next dev startup
  (~30s cold, much less on hot reuse).
