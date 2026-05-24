# Spec: Locale-aware notification templates (phase 11.5)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phases 11.1–11.4 localized every PWA's in-screen surface. Email,
push, and in-app titles still rendered in English regardless of the
recipient's preference, so a tenant who flipped to Vietnamese on
their phone still got an English email when their landlord generated
a bill.

11.5 makes `notifications.templates.ts` locale-aware. The recipient's
`User.locale` (added in 11.2) is the source of truth. The dispatch
path picks it up when persisting the `Notification` row so the
in-app inbox renders correctly; the send worker re-reads it so the
email body + push payload reflect a locale flip that happens between
dispatch and send.

## 2. User stories

- As a **tenant who switched to English**, the email I get when my
  landlord issues a bill arrives with an English subject + body,
  not Vietnamese.
- As an **owner on Vietnamese**, "new ticket" alerts land in
  Vietnamese in both my inbox and my inbox notification.
- As an **owner who just flipped to English** while a notification
  was in the BullMQ queue, the email I receive is in English (the
  worker re-renders with the current `User.locale`).

## 3. Surfaces

| Surface         | App / file                                                 | Notes                                                                                       |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Template module | `apps/api/src/notifications/notifications.templates.ts`    | `renderNotification(topic, data, locale)`. EN + VI renderer tables; default `'vi'`.         |
| Dispatch path   | `apps/api/src/notifications/notifications.service.ts`      | Fetches `User.locale` inside the dispatch tx before rendering title/body for persistence.   |
| Send worker     | `apps/api/src/notifications/notifications.worker.ts`       | Selects `user.locale` in the `findUnique` include; re-renders for the email + push payload. |
| Tests           | `apps/api/src/notifications/notifications.service.spec.ts` | New per-locale renderer tests + dispatch/worker assertions for the EN ↔ VI behaviour.       |

## 4. API change

```ts
export function renderNotification(
  topic: NotificationTopic,
  data: NotificationData,
  locale?: Locale, // defaults to defaultLocale ('vi')
): RenderedNotification;
```

Callers pass the recipient's locale explicitly; omitting it produces
Vietnamese (the platform default per BUILD_PLAN §8). Three call-sites
update:

1. `NotificationsService.dispatch` — fetches `User.locale` via a
   small `tx.user.findUnique` alongside the existing preference + quiet-hours
   lookups, then renders title + body in that locale before persisting
   the row.
2. `NotificationsSendWorker.process` — extends the existing
   `include: { user: { select: { email: true } } }` with `locale: true`,
   re-renders title + body + emailHtml/emailText with the
   freshly-read locale. The persisted `row.title` is only consulted
   for the in-app inbox; the email subject + push title come from
   the re-render.
3. Both call-sites narrow the locale via `localeSchema.safeParse` so
   a stale or hand-mutated row falls back to `defaultLocale` instead
   of crashing the worker.

## 5. Translation conventions

Same as the PWA slices:

- Brand strings stay literal ("bdsmonorepo" footer).
- Money rendered as `<amount> <currency>` regardless of locale —
  email clients render formatting inconsistently across locales, so
  we keep amounts unambiguous (Phase 11.7 may revisit with
  `Intl.NumberFormat` if email-client testing shows it's safe).
- Fallback placeholders translated per locale: `(unknown)` in EN,
  `(không xác định)` in VI.
- HTML email shell + the footer line stay the same; only the heading
  - body paragraphs flip locale.

## 6. Why dispatch persists in the recipient's locale

Two paths read the persisted row:

- The **in-app inbox** renders `row.title` + `row.body` as-is.
- The **send worker** re-renders for email + push.

If dispatch persisted in `defaultLocale` only, an EN user's inbox
would show Vietnamese until the worker re-renders. So dispatch picks
the recipient's locale too — only one extra `findUnique` (already
inside the dispatch tx, no round-trip cost worth mentioning).

The worker still re-renders rather than trusting the persisted
title, because:

- A user can flip locale between dispatch and send (especially during
  quiet-hours delays).
- The 10.2 stuck-notifications sweeper re-enqueues old rows; a row
  persisted on the EN template when the user was on EN should reach
  them on the VI template if they've since flipped — the worker is
  the authoritative locale read at send time.

## 7. Edge cases

- **Unknown locale on the row** (`'de'` from a hand-edit): both
  paths fall back to `defaultLocale` via `localeSchema.safeParse`.
- **Missing user row** in dispatch (theoretical — recipient deleted
  between event and dispatch): defaults to `vi` and proceeds. The
  row is harmless; the worker will hit `no-email` and drop it.
- **No locale supplied** to `renderNotification` (tests, legacy
  callers): defaults to `vi` per the function signature.
- **Push payload**: title + body are derived from the same render as
  the email, so push notifications match the email language. No
  separate push-locale handling.

## 8. Out of scope

- **`Intl.NumberFormat`-driven money formatting** — Phase 11.7
  picks up locale-aware money/date helpers across the platform.
- **More languages** — adding a third locale is a renderer-table
  add + a `localeSchema` enum value; no template-engine work.
- **Per-template overrides via PlatformConfig** — operators can't
  edit copy in the database in v1. The renderer table is the source
  of truth.
- **Email-client locale rendering checks** — out of scope here;
  Phase 6.4 / Sentry will surface broken renders.

## 9. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `renderNotification(topic, data, 'en')` returns English text
      for all seven topics.
- [ ] `renderNotification(topic, data, 'vi')` returns Vietnamese text
      for all seven topics.
- [ ] `renderNotification(topic, data)` (no locale) returns
      Vietnamese — the Phase 11 default.
- [ ] `NotificationsService.dispatch` persists `row.title` in the
      recipient's locale (verified for vi + en).
- [ ] `NotificationsSendWorker.process` sends the email with the
      recipient's locale subject + body (verified for vi + en).
- [ ] Existing 410 API tests stay green.

## 10. Manual test plan

1. Seed a tenant whose `User.locale = 'en'`.
2. Generate a bill via owner CRUD; observe the row in
   `/notifications` on the tenant app — title in English.
3. Confirm MailHog received an email with an English subject.
4. Flip the tenant's locale to `vi` via `PATCH /v1/me`.
5. Generate another bill; observe Vietnamese in both inbox + email.
6. Manually mute the email channel on a topic, dispatch, then flip
   locale; the in-app inbox row should be in the locale at dispatch
   time (no second render fires).

## 11. Rollout

- No migrations.
- No env vars.
- No feature flag — the change is invisible to a user on `vi`
  (the existing platform default) and immediately improves the
  experience for anyone on `en`.
- Stripe / VNPay payment webhooks fire dispatch on success — they
  pick up the recipient's locale automatically.
