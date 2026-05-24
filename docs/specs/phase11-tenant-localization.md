# Spec: Tenant PWA localization (phase 11.3)

> Status: **shipped** (both slices A + B)
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

**Slice A** covered the chrome + auth surface: layout metadata,
login, landing tiles, account / language preference, the forbidden
page, the offline page, the public undo-email page, and the
locale-switcher placement.

**Slice B** (this PR) covers everything else in `apps/tenant`:
my-bills (list, detail, pay-online, payment-success/cancelled,
vnpay return, download-receipt), my-leases (list, detail, ratings
card), my-tickets (list, detail, new form, thread, reopen),
notifications (inbox, preferences, push), browse (list, detail,
apply form), me/applications (list, detail, withdraw), me/ratings.
After slice B, every user-facing string in the tenant PWA renders
through `useTranslations`.

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

### Slice A — chrome + auth

| Surface              | App / file                                                        | Notes                                                                                     |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Catalog              | `packages/i18n/src/messages/{en,vi}/tenant.json`                  | Namespace `tenant.*` keyed under sub-domains (`login`, `home`, `account`, …).             |
| i18n loader          | `packages/i18n/src/server.ts`                                     | Adds tenant to the bundled catalogs so `useTranslations('tenant.*')` resolves.            |
| Entrypoint split     | `packages/i18n/package.json`, `packages/i18n/src/index.ts`        | `@repo/i18n` (client-safe) vs `@repo/i18n/server` (cookies/headers).                      |
| Layout metadata      | `apps/tenant/app/layout.tsx`                                      | `generateMetadata()` uses `getTranslations('tenant')` for the description.                |
| Login                | `apps/tenant/app/login/{page,login-form}.tsx`                     | All static text extracted; switcher placed in the page header.                            |
| Landing              | `apps/tenant/app/(authed)/page.tsx`                               | Six tiles + "Coming soon" card extracted, `signedInAs` uses `t.rich` for the bolded name. |
| Account              | `apps/tenant/app/(authed)/me/page.tsx` + `language-card.tsx`      | `LanguageCard` wires the switcher to `PATCH /v1/me` via the 11.2 endpoint.                |
| Delete-account card  | `apps/tenant/app/(authed)/me/_components/delete-account-card.tsx` | Three visual states + all error copy localized.                                           |
| Notification bell    | `apps/tenant/app/(authed)/_components/notification-bell-link.tsx` | `aria-label` localized; takes a plural-ish split between "Notifications" / "…N unread".   |
| Forbidden            | `apps/tenant/app/forbidden/page.tsx`                              | Role-mismatch copy localized; `{role}`+`{appName}` interpolated.                          |
| Offline              | `apps/tenant/app/offline/page.tsx`                                | Client component (needs `window.location.reload`); single retry button.                   |
| Erase-cancel landing | `apps/tenant/app/account/erase-cancel/page.tsx`                   | Public undo page (no auth); three shells localized.                                       |
| Playwright           | `apps/e2e/tests/web/tenant-locale-switcher.spec.ts`               | `tenant-web` project boots the tenant dev server + verifies the vi → en flip.             |

### Slice B — feature pages

| Surface             | App / file                                                                | Notes                                                                                 |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Bills list          | `apps/tenant/app/(authed)/my-bills/page.tsx`                              | Status badges read from `tenant.statuses.bills.*`; ICU plural for the count summary.  |
| Bills detail        | `apps/tenant/app/(authed)/my-bills/[billId]/page.tsx`                     | Period subtitle interpolated; line-kind labels via `tenant.statuses.billLineKinds.*`. |
| Pay-online card     | `apps/tenant/app/(authed)/my-bills/[billId]/_components/pay-online.tsx`   | Stripe/VNPay disabled states + the "we never see your card" hint.                     |
| Payment success     | `apps/tenant/app/(authed)/my-bills/[billId]/payment-success/page.tsx`     | Rich text for the bolded `PAID` token via `t.rich`.                                   |
| Payment cancelled   | `apps/tenant/app/(authed)/my-bills/[billId]/payment-cancelled/page.tsx`   | Single banner.                                                                        |
| VNPay return        | `apps/tenant/app/(authed)/my-bills/[billId]/vnpay/return/page.tsx`        | Success / fail branches; interpolates `{code}` into the failure copy.                 |
| Download receipt    | `apps/tenant/app/(authed)/my-bills/_components/download-receipt.tsx`      | Anchor label only.                                                                    |
| Leases list         | `apps/tenant/app/(authed)/my-leases/page.tsx`                             | Three section headings (active / draft / closed) + ICU rent-per-cycle.                |
| Leases detail       | `apps/tenant/app/(authed)/my-leases/[leaseId]/page.tsx`                   | Money labels + termination card.                                                      |
| Lease ratings card  | `apps/tenant/app/(authed)/my-leases/[leaseId]/ratings-card.tsx`           | Milestone titles + blurbs + pill labels + the "opens on X" copy.                      |
| Tickets list        | `apps/tenant/app/(authed)/my-tickets/page.tsx`                            | Status badges via `tenant.statuses.tickets.*`; category labels.                       |
| Tickets detail      | `apps/tenant/app/(authed)/my-tickets/[id]/page.tsx`                       | Conversation/Details cards + lock-reason fallback.                                    |
| Ticket thread       | `apps/tenant/app/(authed)/my-tickets/[id]/ticket-thread.tsx`              | Empty state, placeholder, send button, role labels via `tenant.statuses.rolesLower`.  |
| Reopen button       | `apps/tenant/app/(authed)/my-tickets/[id]/reopen-button.tsx`              | `window.confirm` localized; button label.                                             |
| New ticket page     | `apps/tenant/app/(authed)/my-tickets/new/page.tsx`                        | No-active-lease empty state + back link.                                              |
| New ticket form     | `apps/tenant/app/(authed)/my-tickets/new/new-ticket-form.tsx`             | All field labels + the lease-option template + cancel/raise buttons.                  |
| Notifications page  | `apps/tenant/app/(authed)/notifications/page.tsx`                         | Header copy only — children own their own translators.                                |
| Inbox client        | `apps/tenant/app/(authed)/notifications/_components/inbox-client.tsx`     | ICU plural for the unread count + mark-all button.                                    |
| Preferences card    | `apps/tenant/app/(authed)/notifications/_components/preferences-card.tsx` | Topic labels + helps live under `tenant.notifications.prefs.topics.*`.                |
| Push toggle         | `apps/tenant/app/(authed)/notifications/_components/push-toggle.tsx`      | All four error-code variants live under `tenant.notifications.push.errors.*`.         |
| Browse list         | `apps/tenant/app/browse/page.tsx`                                         | Filter input placeholders + empty state + price-per-month template.                   |
| Browse detail       | `apps/tenant/app/browse/[id]/page.tsx`                                    | Apply card description switches on role.                                              |
| Apply form          | `apps/tenant/app/browse/[id]/apply-form.tsx`                              | Optional message placeholder + send button.                                           |
| Applications list   | `apps/tenant/app/(authed)/me/applications/page.tsx`                       | Campaign-short label + ICU plural.                                                    |
| Applications detail | `apps/tenant/app/(authed)/me/applications/[id]/page.tsx`                  | Rejected / accepted banners; the no-message italic placeholder.                       |
| Withdraw button     | `apps/tenant/app/(authed)/me/applications/[id]/withdraw-button.tsx`       | `window.confirm` localized.                                                           |
| Ratings page        | `apps/tenant/app/(authed)/me/ratings/page.tsx`                            | Reputation card + per-row milestone label + stars aria-label.                         |

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

- **Owner / partner / admin PWAs** — Phase 11.4.
- **Email + push templates** — Phase 11.5.
- **`Intl.NumberFormat` / locale-aware date helpers** — Phase 11.7.
  Money + date strings continue to use `Intl.*` on the browser
  locale, not the user-chosen locale.
- **Persistent header-level switcher in the (authed) layout** —
  future layout-refresh follow-up. The switcher lives on `/login`
  and `/me` only.

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
