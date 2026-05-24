# Spec: Locale-aware money + date formatters (phase 11.7)

> Status: **shipped**
> Phase: 11
> Owner: claude
> Spec last updated: 2026-05-24

## 1. Why

Phase 11 wired next-intl + ICU plural translation across the four PWAs
(11.1–11.4), persisted user locale (11.2), localized email/push templates
(11.5), and added an SMS OTP path (11.6). The last piece is numbers and
dates.

Today every PWA carries a near-identical `lib/format.ts` that calls
`Intl.NumberFormat(undefined, …)` — passing `undefined` makes Node's
SSR default (typically `en-US`) win, so a Vietnamese tenant viewing the
bills page got `$500.00` instead of `500.000 ₫`. The BUILD_PLAN
§5 acceptance is explicit: "Money amounts render as `1.000.000 ₫` in
`vi` and `1,000,000 VND` in `en`. Dates follow each locale's
conventions." 11.7 makes that real.

## 2. Design

Two layers:

| Layer        | Location                              | Purpose                                                                                   |
| ------------ | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Pure helpers | `packages/shared/src/format.ts`       | `formatMoney`/`formatDate`/`formatDateTime` taking an optional `Locale`. Zero React/Next. |
| React hook   | `packages/i18n/src/use-formatters.ts` | `useFormatters()` — reads `useLocale()` from next-intl, memoizes a bundle bound to it.    |

Why split: `@repo/i18n` transitively depends on `next` + `react`. The
API needs `formatMoney` for receipt rendering and can't pull that in;
`@repo/shared` is the leaf that everyone can use. `@repo/i18n` re-exports
the pure helpers for ergonomic single-import in PWA code.

### Public API

```ts
// pure (server, worker, API, browser)
formatMoney(minor: number, currency: string, locale?: Locale): string;
formatDate(iso: string | null | undefined, locale?: Locale): string;
formatDateTime(iso: string | null | undefined, locale?: Locale): string;

// bundle factory for server components / non-React code
getFormatters(locale: string | null | undefined): Formatters;
//   .formatMoney(minor, currency)
//   .formatDate(iso)
//   .formatDateTime(iso)

// React hook (client components)
useFormatters(): Formatters;
```

`Formatters` is a plain object literal — safe to pass as a prop into
sync server-component children that need to render money/dates.

### Locale narrowing

`getFormatters` accepts the raw `string` from next-intl's
`getLocale()` (which is not narrowed to our canonical set) and falls
back to `defaultLocale` (`'vi'`) for anything outside `['vi', 'en']`.
The pure helpers accept `Locale | undefined` directly; omit the arg to
default to `'vi'`. There is no "system default" path — `undefined` always
maps to the platform default, never the runtime's idea of locale. This is
intentional: SSR `undefined` previously meant en-US which silently
contradicted Vietnamese users' expectations.

### Currency fractional digits

`MINOR_UNIT_DIGITS` overrides for currencies whose minor unit isn't 2:
VND/JPY/KRW → 0, KWD/BHD/OMR → 3. Everything else assumes 2. The Intl
formatter then renders correctly per locale — symbol placement,
thousand-separators, and decimal mark all follow the chosen locale, not
the currency origin.

## 3. Migration policy

| App     | Pattern                                                                                                                                                                                    |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| tenant  | Client comps: `useFormatters()` hook. Server pages: `getFormatters(await getLocale())`; pass `fmt: Formatters` as a prop to sync child server components that render rows/cards.           |
| owner   | Same as tenant.                                                                                                                                                                            |
| partner | Same as tenant.                                                                                                                                                                            |
| admin   | **Pinned to `'en'`.** Admin is English-only per the phase 11.4 carve-out (per `apps/admin/CLAUDE.md`). All call-sites use `getFormatters('en')` regardless of the visitor's locale.        |
| api     | `apps/api/src/bills/bills.receipt.service.ts` imports `formatMoney` from `@repo/shared` and passes `'en'` explicitly — receipts are operator-facing audit artifacts, one canonical layout. |

For sync child server components that need formatters, two flavors:

- **`fmt: Formatters` prop** (preferred when the child renders a row/card and uses several formatters).
- **Pre-formatted string prop** (preferred when only one or two values cross the boundary, e.g. `createdAtFormatted: string`).

For non-component helpers inside the same file (e.g. `notOpenCopy(state, t)`),
pass the specific formatter function as a parameter.

## 4. Receipt PDF — deliberate carve-out

`apps/api/src/bills/bills.receipt.service.ts` formats money with `'en'`
hardcoded. The receipt is a downloadable PDF reviewed by operators (for
audit / KYC / dispute) more often than by tenants — keeping one
canonical layout makes those flows predictable. A future slice may
re-render in the recipient's locale on tenant-initiated downloads if
that becomes a real ask; for now the simplification wins.

The PDF's private `formatMoney` + `MINOR_UNIT_DIGITS` table was deleted
in favor of the shared helper.

## 5. Files touched

- New: `packages/shared/src/format.ts` (95 lines), `packages/shared/src/format.test.ts` (13 unit tests).
- New: `packages/i18n/src/use-formatters.ts` (the React hook).
- Updated: `packages/shared/src/index.ts`, `packages/i18n/src/index.ts` (re-export).
- Deleted: `apps/{tenant,owner,partner,admin}/lib/format.ts` (4 duplicated files).
- Updated: ~55 caller files across the 4 PWAs (each switched from `from '../../../lib/format'` to either `useFormatters()` or `getFormatters(await getLocale())`).
- Updated: `apps/api/src/bills/bills.receipt.service.ts` (private `formatMoney` removed, imports shared helper, pinned to `'en'`).

## 6. Why pass `fmt` as a prop instead of `getFormatters()` per child

Sync server components cannot call `await getLocale()`. The choices:

1. **Make the child async.** Adds an `await` to every render; next-intl
   caches `getLocale()` internally so it's cheap, but it muddies the
   call-graph (an async leaf component reads as a data-fetching
   boundary, not as a presentation helper).
2. **Read the locale once at the page level, pass `fmt` as a prop.**
   Idiomatic React — children get the bundle they need; the page owns
   the locale read. Adopted here.
3. **Pre-format every value in the page, pass primitive strings.**
   Works for small surfaces (one or two formatted values) but doesn't
   scale to a card that uses 5 different formatters.

We use (2) by default and (3) where it's smaller.

## 7. Edge cases

- **Unknown locale string** (e.g. `'de'` from a stale cookie):
  `getFormatters` falls back to `defaultLocale` (`'vi'`); the pure
  helpers' optional `locale?: Locale` parameter is typed so anything
  off-spec is a compile error at the boundary.
- **Invalid ISO-4217 currency** (non-3-letter): `formatMoney` catches
  the `RangeError` from `Intl.NumberFormat` and falls back to the
  literal `<minor> <currency>` so the UI doesn't blow up.
- **Null/undefined date**: `formatDate` / `formatDateTime` return
  `'—'` so callers don't have to branch.
- **Datetime fed into `formatDate`**: the date portion is stripped via
  `iso.slice(0, 10)` so `'2026-05-24T13:00:00Z'` and `'2026-05-24'`
  produce the same output.
- **VND** specifically: the Intl formatter renders `'1.000.000 ₫'` in
  `vi` and `'VND 1,000,000'` in `en` — matches the BUILD_PLAN spec
  exactly.

## 8. Out of scope

- **Locale-aware receipt PDF** — pinned to English. See §4.
- **Per-property currency** — outside Phase 11 entirely.
- **`Intl.RelativeTimeFormat`** — no "2 days ago" / "in 3 hours"
  rendering yet; current surfaces use absolute dates.
- **Intl-driven number formatting outside money/date** — e.g. m² and
  bedroom counts continue to use plain ICU plural strings; no Intl
  format is needed.
- **More languages** — adding a third locale is appending to
  `KNOWN_LOCALES` + `defaultLocale` doesn't change; every formatter call
  picks the new value up automatically.

## 9. Acceptance criteria

- [ ] `pnpm turbo typecheck` / `lint` / `test` clean across the repo.
- [ ] `formatMoney(1_000_000, 'VND', 'vi')` renders with `.` as the
      thousands separator and `₫` symbol.
- [ ] `formatMoney(1_000_000, 'VND', 'en')` renders with `,` as the
      thousands separator and `VND` code prefix.
- [ ] All four PWAs' `lib/format.ts` are deleted; no caller still
      imports from the removed path.
- [ ] Admin renders all money/dates in English regardless of the
      visitor's locale cookie.
- [ ] Receipt PDF still renders identically to before (English, same
      currency precision rules) — it just imports the shared helper.

## 10. Manual test plan

1. Sign in to tenant as a `vi` user; visit `/my-bills/<id>` — money
   renders as `1.000.000 ₫`, dates as `24 thg 5, 2026`.
2. Flip the locale switcher to `en`; refresh; same screen renders
   `VND 1,000,000` and `May 24, 2026`.
3. Sign in to owner; same expectation on `/houses/<id>/units/<u>/leases/<l>/bills/<b>`.
4. Sign in to admin (currently English UI) on a `vi`-flipped cookie;
   confirm admin still renders in English.
5. Download a receipt PDF from `/my-bills/<id>` (tenant) — money is in
   English.

## 11. Rollout

- No DB migration.
- No env vars.
- No feature flag — change is invisible to existing `en` users
  (formatting matches their browser default) and immediately
  correct for `vi` users (was wrong before).
- Stripe / VNPay redirect screens carry the chosen locale forward
  automatically (cookie is path-`/`).
