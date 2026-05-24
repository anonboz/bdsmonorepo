# Spec: Owner PWA localization (phase 11.4b)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 11.4a localized the partner PWA. This slice does the same for
the owner PWA — the largest surface in the platform — bringing the
total to three of four PWAs in vi+en. Admin remains English-only per
its CLAUDE.md (internal-facing, smaller surface).

After this slice, every public-facing PWA renders entirely in the
user's chosen locale.

## 2. User stories

- As an **owner signing up from a Vietnamese-locale browser**, the
  whole flow — login, dashboard, houses/units/leases/bills CRUD,
  campaigns, tickets, partner bookings, payouts/charges, ratings —
  renders in Vietnamese.
- As an **owner managing a house**, the moderation banners,
  publication state, and the deletion-confirm dialog read in my
  preferred language.
- As an **owner on `/me`**, I flip language via the new
  `LanguageCard`; `User.locale` updates server-side and the next
  page renders in the new language.

## 3. Surfaces

| Group                | Surface                                                                   | Notes                                                                           |
| -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Catalog              | `packages/i18n/src/messages/{en,vi}/owner.json`                           | New `owner.*` namespace mirroring tenant/partner.                               |
| i18n loader          | `packages/i18n/src/server.ts`                                             | Adds `owner` to `messageCatalogs`.                                              |
| Chrome               | `app/layout.tsx`, `app/login/*`, `app/forbidden`, `app/offline`           | Metadata, login form, forbidden, offline.                                       |
| Landing              | `app/(authed)/page.tsx`                                                   | Eight tiles + signedInAs rich-text + coming-soon card.                          |
| /me account          | `app/(authed)/me/page.tsx` + `_components/language-card.tsx`              | New `/me` index page hosting the LanguageCard.                                  |
| Notification bell    | `app/(authed)/_components/notification-bell-link.tsx`                     | `aria-label` localized with count split.                                        |
| Dashboard            | `app/(authed)/dashboard/page.tsx`                                         | Stats grid, overdue + recent bills tables, empty state.                         |
| Houses               | `houses/page.tsx`, `houses/new/page.tsx`, `houses/[id]/page.tsx`, edit    | List, detail, edit, form, moderation banner.                                    |
| House form / delete  | `houses/_components/{house-form,delete-house-button}.tsx`                 | Address fieldset, country help, delete confirm.                                 |
| Units                | `units/page.tsx`, `units/new`, `units/[unitId]/page.tsx`, edit            | Status badge, stats line, unit form.                                            |
| Unit form / delete   | `units/_components/{unit-form,delete-unit-button}.tsx`                    | All field labels + status select; delete confirm.                               |
| Leases               | `leases/_components/{lease-list-card,lease-form,lease-transitions}.tsx`   | List card, full form, transition buttons + prompts.                             |
| Leases detail        | `leases/[leaseId]/page.tsx`, edit, ratings-card, generate-now             | Status badge, money grid, termination banner, actions copy per state.           |
| Bills card           | `leases/[leaseId]/_components/bills-card.tsx`                             | Empty-active / empty-inactive split + count.                                    |
| Generate-now         | `leases/[leaseId]/_components/generate-now-button.tsx`                    | Created / idempotent / failed messages.                                         |
| Rate tenant          | `leases/[leaseId]/_components/ratings-card.tsx`                           | Milestone titles, blurbs, pill labels, opens-at copy.                           |
| Bill detail          | `bills/[billId]/page.tsx` + `download-receipt.tsx` + `payments-panel.tsx` | Lines table, payments table, record-payment form, refund dialog.                |
| Campaigns            | `campaigns/_components/{campaign-list-card,campaign-form}.tsx`            | Status badge, full form with photo uploader.                                    |
| Campaign new / edit  | `campaigns/new/page.tsx`, `campaigns/[campaignId]/edit/page.tsx`          | Titles + subtitles + back links.                                                |
| Campaign detail      | `campaigns/[campaignId]/page.tsx` + `campaign-actions.tsx`                | Rejected banner, listing card, actions copy per state, transition prompts.      |
| Campaign delete      | `campaigns/[campaignId]/_components/delete-campaign-button.tsx`           | Delete confirm with title interpolation.                                        |
| Applications panel   | `campaigns/[campaignId]/_components/applications-panel.tsx`               | Application count + status badges.                                              |
| Application actions  | `campaigns/[campaignId]/_components/application-actions.tsx`              | Accept / reject prompts + error banners.                                        |
| Tickets              | `tickets/page.tsx`, `tickets/[id]/page.tsx`                               | List with attention/closed split; detail with actions copy per state.           |
| Ticket thread        | `tickets/[id]/ticket-thread.tsx`                                          | Empty state, placeholder, send button, role labels.                             |
| Ticket transitions   | `tickets/[id]/ticket-transitions.tsx`                                     | All transition labels + close-confirm.                                          |
| Partner jobs card    | `tickets/[id]/partner-jobs-card.tsx`                                      | Empty / count / request-button / reopen-hint.                                   |
| Partners             | `partners/page.tsx`, `partners/[id]/page.tsx`                             | KYC badge, ratings summary, services summary, book card.                        |
| Book partner         | `partners/[id]/book/{page,book-form}.tsx`                                 | Title with name interpolation; service select; description form.                |
| Service jobs         | `me/service-jobs/page.tsx`, `me/service-jobs/[id]/page.tsx`               | Subtitle (requested/quoted/final), cancelled banner, request body.              |
| Job actions / rating | `me/service-jobs/[id]/{owner-job-actions,owner-rating-panel}.tsx`         | Accept / cancel prompts; rating submit form + other-side display.               |
| Charges              | `me/charges/page.tsx`                                                     | Table headers + empty state.                                                    |
| Ratings              | `me/ratings/page.tsx`                                                     | Reputation card, ICU plural rating count, milestone labels, stars aria.         |
| Notifications        | `notifications/page.tsx`, `inbox-client.tsx`, `preferences-card.tsx`      | Unread count plural, mark-all, topic labels (`ticket.opened`, `job.completed`). |

## 4. Catalog layout

```
packages/i18n/src/messages/
├── en/
│   ├── common.json
│   ├── tenant.json
│   ├── partner.json
│   └── owner.json   ← NEW
└── vi/
    ├── common.json
    ├── tenant.json
    ├── partner.json
    └── owner.json   ← NEW
```

Same conventions as the other PWAs: per-surface sub-namespaces
(`owner.houses`, `owner.leases`, `owner.bills`, …) plus a shared
`owner.statuses.*` bucket for enum-style labels (bills, leases,
units (Title-cased + lowercase variants), tickets, ticket categories,
campaigns, applications, jobs, rent cycles, bill-line kinds, KYC,
role labels). ICU plural handles "N houses / units / tenants /
ratings / unread"; `t.rich` handles the bolded name on the landing
page + bolded `email` token in the OTP step.

## 5. Locale switcher placement

The owner app had no `/me` index page — only `/me/charges`,
`/me/ratings`, `/me/service-jobs`. This slice adds a new
`/me` page that hosts the `LanguageCard` (wired to `PATCH /v1/me`).
The login page also gets the cookie-only switcher in the top-right,
matching the pattern from tenant + partner slices.

## 6. Vietnamese translations

Same conventions as previous slices:

- Brand kept literal ("BDS Chủ nhà" for owner).
- Imperative buttons.
- Currency / dates still via `Intl.NumberFormat` on browser locale
  (phase 11.7 promotes those to shared helpers).

Domain-specific glossary (additions to the partner glossary):

| EN          | VI                            |
| ----------- | ----------------------------- |
| Owner       | Chủ nhà                       |
| House       | Nhà                           |
| Unit        | Căn / Căn hộ                  |
| Lease       | Hợp đồng                      |
| Bill        | Hóa đơn                       |
| Refund      | Hoàn tiền                     |
| Campaign    | Tin đăng                      |
| Application | Đơn đăng ký                   |
| Ticket      | Yêu cầu                       |
| Acknowledge | Tiếp nhận                     |
| MRR         | (kept literal — finance term) |
| KYC         | (kept literal — abbreviation) |

## 7. Out of scope

- **Admin PWA** — stays English-only per `apps/admin/CLAUDE.md`.
- **Email + push templates** — Phase 11.5.
- **Locale-aware money / date helpers** — Phase 11.7.
- **Persistent header-level switcher** in (authed) layout — future
  layout-refresh follow-up. Switcher lives on `/login` and `/me`.

## 8. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `pnpm --filter @repo/owner build` succeeds.
- [ ] Visiting `/login` with no cookie + `Accept-Language: vi`
      renders the login form in Vietnamese.
- [ ] Logged-in owner flips locale via `/me` → next page is English;
      `/v1/me` returns `user.locale: "en"`.
- [ ] Dashboard stats grid, houses/units/leases/bills CRUD, campaign
      detail, ticket detail, partner browse + book, service-jobs
      detail, payouts/charges, ratings — all render in the active
      locale.

## 9. Manual test plan

1. `pnpm turbo dev` — API + owner on port 3010.
2. Clear cookies. Open `http://localhost:3010/login` with the
   browser language set to Vietnamese (or any unknown locale): all
   strings localized.
3. Pick "English" in the top-right switcher — page reloads in
   English. Refresh: still English.
4. Log in as a seeded owner email. Open `/me`. Confirm
   `LanguageCard` is present.
5. Flip to Vietnamese in `/me`. Confirm `/v1/me` returns
   `user.locale: "vi"` (DevTools → Network).
6. Walk through: create house → create unit → create lease → activate
   → generate bill → record payment → refund. All copy localized.
7. Create a campaign → submit for review → applications panel.
8. Browse partners → book one → service-jobs detail.

## 10. Rollout

- No migrations.
- No env vars.
- No feature flag — owner defaults to Vietnamese for new sessions
  immediately. Existing owner rows already carry `locale = 'vi'`
  from the 11.2 default.

## 11. Phase 11.4 closeout

With this slice, **three of four PWAs are fully localized** (tenant,
partner, owner). Admin remains English-only by design.

Remaining Phase 11 work:

- **11.5** — Locale-aware notification templates (email + push)
- **11.6** — SMS OTP via VN gateway
- **11.7** — Shared locale-aware money + date helpers
