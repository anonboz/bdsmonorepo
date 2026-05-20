# Spec: Campaigns — public feed + expiry (phase 4.3)

> Status: **implemented (sans Playwright e2e)**
> Phase: 4
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

4.1 + 4.2 gave us the owner → admin pipeline that lands campaigns in
`LIVE`. Nobody can see them yet. 4.3 opens two surfaces:

1. **Public read API** so prospects (and search-engine crawlers) can
   browse listings without an account.
2. **Tenant app pre-login browse**: SSR pages that render the feed and
   a detail view. Applying still gates on auth (lands in 4.4) — this
   slice is read-only.

The third thing 4.3 owns is the **expiry sweeper**: a BullMQ daily job
that flips `LIVE → EXPIRED` when `expiresAt < now`, so the public feed
stays honest without owners having to close stale listings by hand.

## 2. User stories

- As a **prospect** with no account, I want to browse listings filtered
  by city / country / price so I can find a place that fits.
- As a **prospect**, I want a deep link to a listing detail so I can
  share it / re-find it later.
- As a **search-engine crawler**, I want each campaign reachable from a
  predictable URL with semantic markup so it can be indexed.
- As the **platform**, I want `EXPIRED` campaigns to fall out of the
  feed without anyone clicking anything.

## 3. Screens / surfaces

| Surface         | App    | Route                          | Notes                                   |
| --------------- | ------ | ------------------------------ | --------------------------------------- |
| Browse list     | tenant | `/browse`                      | SSR, pre-login. Filters via query.      |
| Browse detail   | tenant | `/browse/[id]`                 | SSR, pre-login. "Apply" CTA gates auth. |
| Public list API | api    | `GET /v1/public/campaigns`     | `@Public()` — no auth                   |
| Public detail   | api    | `GET /v1/public/campaigns/:id` | `@Public()`                             |

## 4. API shape

```ts
// @repo/shared/schemas/campaigns.ts — new public projection
export const publicCampaignSchema = z.object({
  id: idSchema,
  ownerId: idSchema, // for ratings cross-link
  unitId: idSchema,
  houseId: idSchema,
  title: z.string(),
  body: z.string(),
  price: z.number().int().nonnegative(),
  currency: currencySchema,
  photos: z.array(z.string().url()),
  publishedAt: isoDateTimeSchema, // always non-null for public
  expiresAt: isoDateTimeSchema.nullable(),

  // Denormalized house + unit info so the listing renders without N+1.
  house: z.object({
    name: z.string(),
    city: z.string(),
    country: z.string().length(2),
  }),
  unit: z.object({
    label: z.string(),
    bedrooms: z.number().int().nullable(),
    bathrooms: z.number().int().nullable(),
    sqm: z.number().int().nullable(),
  }),
});

export const listPublicCampaignsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  minPrice: z.coerce.number().int().nonnegative().optional(),
  maxPrice: z.coerce.number().int().nonnegative().optional(),
});
```

Default sort: `publishedAt desc` then `id desc`. Limit ≤ 50 (lower
ceiling than authenticated lists since this is a public surface).

### Endpoints

| Method | Path                       | Auth        | Description             |
| ------ | -------------------------- | ----------- | ----------------------- |
| GET    | `/v1/public/campaigns`     | `@Public()` | Paginated, filtered     |
| GET    | `/v1/public/campaigns/:id` | `@Public()` | Single, 404 if not LIVE |

**What's hidden from the public projection:** `moderation*`, `status`
(implied `LIVE`), `createdAt` / `updatedAt`, `deletedAt`. Internal
trail isn't relevant outside admin tooling.

## 5. Visibility filter

A campaign is visible publicly iff:

```
status === 'LIVE'
  AND deletedAt IS NULL
  AND (expiresAt IS NULL OR expiresAt > now())
```

Any other state → 404 on the detail endpoint, never returned by list.

The list also filters out campaigns whose **house has been REJECTED by
admin moderation** (Phase 3.4b) — a rejected house shouldn't surface
its campaigns. SQL: `unit.house.moderationStatus != 'REJECTED'`. (House
`OK` or `FLAGGED` still shows; flagged is a heads-up to the owner but
isn't strict take-down.)

## 6. Data model changes

None. Existing fields cover everything.

## 7. Workers / jobs

New BullMQ queue `campaigns.expiry-sweep` with a daily repeat at
`05:00 UTC` (1h after the bills sweep so we don't double-up DB load).

The sweeper does one `findMany` for `{ status: 'LIVE', expiresAt:
{ lt: now }, deletedAt: null }`, then per row runs a transaction:

```ts
tx.campaign.update({ status: 'EXPIRED', publishedAt unchanged }) +
audit.write('campaign.expire', target=Campaign:<id>, meta={ previousStatus: 'LIVE', expiresAt, source: 'sweeper' }, actorId: null)
```

Same `source: 'sweeper'` convention from the bills sweeper. If the
update fails for one row the transaction rolls back that row only; the
sweeper keeps going for the rest.

The sweeper is registered as a repeating job using the same stable
`REPEAT_JOB_ID_*` pattern that bills uses; restart is idempotent.

## 8. Permissions

- **Anyone** (signed in or not) can hit `/v1/public/campaigns*` — guarded
  by `@Public()`. AuthGuard skips; no `@Roles()` on the routes.
- **Suspended user** signed in: still sees the feed. They can't apply
  (4.4) but the feed itself is open by intent.
- **Owner / Admin / Tenant** all see the same projection — these
  endpoints are the public read surface, not a role-specific view.

## 9. Audit log

| Action            | Target          | Meta keys                                                         | Actor           |
| ----------------- | --------------- | ----------------------------------------------------------------- | --------------- |
| `campaign.expire` | `Campaign:<id>` | `previousStatus` (`LIVE`), `expiresAt` (ISO), `source: 'sweeper'` | `null` (worker) |

The existing owner / admin codes (`campaign.submit / withdraw / close /
approve / reject`) are unchanged.

## 10. Edge cases

- **Detail GET on a DRAFT / PENDING / REJECTED / CLOSED / EXPIRED
  campaign** → 404 (existence-hiding mirrors private endpoints).
- **Detail GET on a campaign whose unit's house is REJECTED** → 404.
- **Empty result** — list returns `{ items: [], nextCursor: null }`,
  not 404.
- **`minPrice > maxPrice`** — empty result (no special error; Zod
  validates each independently).
- **Owner is suspended** — campaigns of suspended owners _still show_
  (a campaign was approved at submission time; suspension is on the
  account, not the listing). Admin can flip the house to REJECTED or
  the campaign to REJECTED to take it down.
- **Sweeper hits Redis-disabled env** — same handling as bills:
  registration is skipped and processors never fire.

## 11. Out of scope

- **Application flow** — 4.4. Detail page's "Apply" CTA links to
  `/login?next=/browse/[id]` for unauthenticated users; auth users get
  the apply form. (Form rendering is 4.4.)
- **Photo CDN / image proxy** — Phase 5+ alongside S3 storage. v1
  loads photo URLs directly.
- **Personalization / saved searches** — later.
- **SEO sitemap / structured data** — markup-light v1; sitemap can
  ship later.
- **Geo / distance search** — needs PostGIS or similar.
- **Currency conversion in filters** — `minPrice / maxPrice` apply to
  raw `price`. Filtering across currencies is a Phase 5+ concern.

## 12. Acceptance criteria

- [x] `GET /v1/public/campaigns` returns LIVE + non-expired campaigns
      for any caller, including unauthenticated.
- [x] Filters by `city`, `country`, `minPrice`, `maxPrice`, `q` work.
- [x] `GET /v1/public/campaigns/:id` returns the projection for a
      visible campaign and 404 for everything else.
- [x] Campaigns whose house is `REJECTED` are hidden from list + detail.
- [x] Tenant `/browse` and `/browse/[id]` render without a session
      (pre-login, no redirect to /login).
- [x] An "Apply" CTA on the detail page links to `/login?next=...`
      when there's no session, otherwise the auth (4.4) target.
- [x] BullMQ sweeper run flips eligible LIVE campaigns to EXPIRED
      and writes a `campaign.expire` audit row per row.

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with the rest of Phase 4). Coverage held by the 5 new
public/sweeper cases in `campaigns.service.spec.ts` (23 total).

## 13. Manual test plan

1. As admin, approve a PENDING campaign → owner sees status LIVE.
2. Sign out, hit `/browse` in an incognito window → see the campaign.
3. Filter `?city=Hanoi` → list reflects.
4. Open the detail page → see photos + description; click "Apply" →
   redirects to `/login?next=/browse/<id>`.
5. As admin, flag the parent house to REJECTED → refresh browse →
   campaign disappears.
6. Set `expiresAt` to yesterday in the DB → fire the sweeper queue →
   campaign flips EXPIRED; `/v1/public/campaigns/:id` returns 404.

## 14. Rollout

- No migration. No flag.
- The sweeper queue is registered on app boot; restart is idempotent.
- Comms: dev changelog note ("public listings + expiry sweep live").
