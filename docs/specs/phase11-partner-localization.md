# Spec: Partner PWA localization (phase 11.4a)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 11.3 brought the tenant PWA to 100% vi+en coverage. 11.4
brings the same treatment to the two other public-facing PWAs:
**partner first** (this slice), **owner next**. Admin stays
English-only per BUILD_PLAN §5.4 — its CLAUDE.md already documents
the carve-out.

The partner surface is smaller (~25 source files) so it lands as one
self-contained PR.

## 2. User stories

- As a **partner signing up from a Vietnamese-locale browser**, the
  whole flow — login, profile setup, services, jobs, payouts —
  renders in Vietnamese without me touching anything.
- As a **logged-in partner**, I open `/profile` and use the new
  `LanguageCard` to flip the language; `User.locale` updates and the
  next page render is English.
- As an **anonymous visitor** on `/login`, the language switcher
  works (cookie-only).

## 3. Surfaces

| Surface             | App / file                                                                 | Notes                                                                                         |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Catalog             | `packages/i18n/src/messages/{en,vi}/partner.json`                          | New `partner.*` namespace mirroring tenant's shape (chrome, login, home, statuses, …).        |
| i18n loader         | `packages/i18n/src/server.ts`                                              | Adds `partner` to `messageCatalogs` so `useTranslations('partner.*')` resolves.               |
| Layout metadata     | `apps/partner/app/layout.tsx`                                              | `generateMetadata()` uses `getTranslations('partner')`.                                       |
| Login               | `apps/partner/app/login/{page,login-form}.tsx`                             | All text extracted; LocaleSwitcher placed in the page header (cookie-only, no `onSave`).      |
| Landing             | `apps/partner/app/(authed)/page.tsx`                                       | Four tiles + coming-soon card extracted; `signedInAs` uses `t.rich` for the bolded name.      |
| Notification bell   | `apps/partner/app/(authed)/_components/notification-bell-link.tsx`         | `aria-label` localized with the count-aware split.                                            |
| Forbidden           | `apps/partner/app/forbidden/page.tsx`                                      | Role-mismatch copy; interpolates `{role}` + `{appName}`.                                      |
| Offline             | `apps/partner/app/offline/page.tsx`                                        | Single retry button.                                                                          |
| Jobs list           | `apps/partner/app/(authed)/jobs/page.tsx`                                  | Status badges via `partner.statuses.jobs.*`; "Direct booking" / "Requested {date}" templates. |
| Jobs detail         | `apps/partner/app/(authed)/jobs/[id]/page.tsx`                             | Cancelled / Request / Actions / Proof / Rating cards.                                         |
| Job actions         | `apps/partner/app/(authed)/jobs/[id]/job-actions.tsx`                      | Send-quote / start / mark-complete / cancel buttons; `window.prompt` localized.               |
| Partner rating      | `apps/partner/app/(authed)/jobs/[id]/partner-rating-panel.tsx`             | Submit form + already-rated banner + counterparty rating banner.                              |
| Services list       | `apps/partner/app/(authed)/services/page.tsx`                              | Profile-required / empty / list states.                                                       |
| Service detail      | `apps/partner/app/(authed)/services/[id]/page.tsx`                         | Edit / Delete actions + descrption / bookings cards.                                          |
| Service form        | `apps/partner/app/(authed)/services/_components/service-form.tsx`          | All field labels + placeholder + active toggle copy.                                          |
| Service new         | `apps/partner/app/(authed)/services/new/page.tsx`                          | Back link + title.                                                                            |
| Service edit        | `apps/partner/app/(authed)/services/[id]/edit/page.tsx`                    | Back link + title.                                                                            |
| Delete service btn  | `apps/partner/app/(authed)/services/[id]/delete-service-button.tsx`        | `window.confirm` localized.                                                                   |
| Profile page        | `apps/partner/app/(authed)/profile/page.tsx`                               | Business card + new `LanguageCard` between business and Stripe.                               |
| Profile form        | `apps/partner/app/(authed)/profile/profile-form.tsx`                       | All labels + saved-banner copy + publish/save toggle.                                         |
| Stripe Connect card | `apps/partner/app/(authed)/profile/stripe-connect-card.tsx`                | Three states (Active / Restricted / NotStarted-or-Onboarding); badges via `t.rich`.           |
| Language card       | `apps/partner/app/(authed)/profile/language-card.tsx`                      | New — mirrors tenant's. Wires LocaleSwitcher onSave → `PATCH /v1/me`.                         |
| Payouts             | `apps/partner/app/(authed)/payouts/page.tsx`                               | Three summary cards + ledger table headers + status badges via `partner.statuses.payouts.*`.  |
| Notifications page  | `apps/partner/app/(authed)/notifications/page.tsx`                         | Header copy only.                                                                             |
| Inbox client        | `apps/partner/app/(authed)/notifications/_components/inbox-client.tsx`     | Unread-count ICU plural + mark-all.                                                           |
| Preferences card    | `apps/partner/app/(authed)/notifications/_components/preferences-card.tsx` | Topic labels + helps under `partner.notifications.prefs.topics.*`.                            |

## 4. Catalog layout

```
packages/i18n/src/messages/
├── en/
│   ├── common.json
│   ├── tenant.json
│   └── partner.json   ← NEW
└── vi/
    ├── common.json
    ├── tenant.json
    └── partner.json   ← NEW
```

Same convention as `tenant.*`: per-surface sub-namespaces
(`partner.jobs`, `partner.services`, …) plus a shared
`partner.statuses.*` for enum-style labels (jobs, payouts). ICU
plural handles the few count strings; `t.rich` handles the bolded
name on the landing page, the bolded email on the OTP step, and the
inline Stripe status badges.

## 5. Locale switcher placement

Same pattern as tenant slice A:

- **`/login`** (anonymous) — switcher in the top-right of the page,
  cookie-only.
- **`/profile`** (authenticated) — new `LanguageCard` between the
  business form and the Stripe Connect card, wired to `PATCH /v1/me`.

## 6. Vietnamese translations

Conventions match tenant slice A/B:

- Brand kept literal ("BDS Đối tác" for partner).
- Imperative buttons.
- Full-sentence error copy.
- Currency / dates still via `Intl.NumberFormat` on browser locale —
  phase 11.7 promotes those to shared helpers.

Domain-specific glossary:

| EN             | VI                            |
| -------------- | ----------------------------- |
| Partner        | Đối tác                       |
| Job            | Công việc                     |
| Service        | Dịch vụ                       |
| Quote          | Báo giá                       |
| Payout         | Thanh toán                    |
| Disbursed      | Đã chuyển                     |
| Held           | Đang giữ                      |
| Released       | Đã giải phóng                 |
| Stripe Connect | (untranslated — brand)        |
| KYC            | (untranslated — abbreviation) |

## 7. Out of scope

- **Owner PWA** — Phase 11.4b (separate PR; the big one).
- **Admin** — stays English-only per its CLAUDE.md.
- **Email + push templates** — Phase 11.5.
- **Locale-aware money / date helpers** — Phase 11.7.
- **Persistent header-level switcher** in (authed) layout — future
  layout-refresh follow-up. Switcher lives on `/login` and
  `/profile` only.

## 8. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `pnpm --filter @repo/partner build` succeeds.
- [ ] Visiting `/login` with no cookie + `Accept-Language: vi`
      renders the login form in Vietnamese.
- [ ] Logged-in partner flips locale via `/profile` → next page is
      English; `/v1/me` returns `user.locale: "en"`.
- [ ] Job detail page renders status badge, request, actions, proof,
      rating cards in the active locale.
- [ ] Payouts table headers + status labels render in the active
      locale.

## 9. Manual test plan

1. `pnpm turbo dev` — API + partner on port 3030.
2. Clear cookies. Open `http://localhost:3030/login` with the
   browser language set to Vietnamese (or any unknown locale): all
   strings localized.
3. Pick "English" in the top-right switcher — page reloads in
   English. Refresh: still English.
4. Log in as a seeded partner email. Open `/profile`. Confirm
   `LanguageCard` appears between business form and Stripe card.
5. Flip to Vietnamese in `/profile`. Confirm `/v1/me` returns
   `user.locale: "vi"` (DevTools → Network).
6. Open `/jobs` and `/payouts`. Confirm status badges +
   table headers are localized.
7. Stop the API: `/offline` renders localized.

## 10. Rollout

- No migrations.
- No env vars.
- No feature flag — partner defaults to Vietnamese for new sessions
  immediately. Existing partner rows already carry `locale = 'vi'`
  from the 11.2 default.
