# Spec: Partner profile + service catalog (phase 5.1)

> Status: **implemented (sans Playwright e2e)**
> Phase: 5
> Owner: claude
> Spec last updated: 2026-05-20

## 1. Why

Phase 5 lights up the partner marketplace. Before owners can book
partners (5.2), partners need a profile + a service catalog, and owners
need a way to discover both. This is the foundation slice: schema is
already scaffolded, this just wires the endpoints + UI for both sides.

Direct booking, the job lifecycle, payouts, and ratings layer on top
in 5.2 – 5.5.

## 2. User stories

- As a **partner**, I want to publish a profile (business name, bio,
  service area) so owners can find me.
- As a **partner**, I want to manage a catalog of services with
  prices so I'm bookable for specific things.
- As an **owner**, I want to browse partners filtered by service area
  / keyword so I can find one for a problem I have.
- As an **owner**, I want to see a partner's active services on their
  detail page so I know what they offer and how much it costs.

## 3. Screens / surfaces

| Surface          | App     | Route            | Notes                               |
| ---------------- | ------- | ---------------- | ----------------------------------- |
| Partner profile  | partner | `/profile`       | Form. PUT-style upsert; idempotent. |
| Partner services | partner | `/services`      | List + new + edit + soft-delete     |
| Partners browse  | owner   | `/partners`      | Filter by `q` (name/area)           |
| Partner detail   | owner   | `/partners/[id]` | Profile + active services           |

## 4. API shape

```ts
// @repo/shared/schemas/partners.ts
export const partnerProfileSchema = z.object({
  id: idSchema,
  userId: idSchema,
  /** Frozen display info read from the User row at write time. */
  displayName: z.string(),
  email: emailSchema.nullable(),
  businessName: z.string().min(1).max(200),
  bio: z.string().max(2000).nullable(),
  serviceArea: z.string().max(500).nullable(),
  kycStatus: kycStatusSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const upsertPartnerProfileSchema = z.object({
  businessName: z.string().trim().min(1).max(200),
  bio: z.string().trim().max(2000).optional(),
  serviceArea: z.string().trim().max(500).optional(),
});

export const serviceSchema = z.object({
  id: idSchema,
  partnerId: idSchema,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  basePrice: z.number().int().nonnegative(),
  currency: currencySchema,
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  basePrice: z.number().int().nonnegative(),
  currency: currencySchema,
  isActive: z.boolean().default(true),
});

export const updateServiceSchema = createServiceSchema.partial();

export const listPartnersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(), // name / area substring
});

/** Owner-side projection — includes active services inline. */
export const partnerSummarySchema = partnerProfileSchema.extend({
  activeServices: z.array(serviceSchema),
});
```

### Endpoints

**Partner** (`@Roles('PARTNER')`):

| Method | Path                     | Description                                  |
| ------ | ------------------------ | -------------------------------------------- |
| GET    | `/v1/me/partner-profile` | 404 if no profile yet                        |
| PUT    | `/v1/me/partner-profile` | Upsert (create-or-update on own User)        |
| GET    | `/v1/me/services`        | List own — both active + soft-deleted hidden |
| POST   | `/v1/me/services`        | Create — requires existing partner profile   |
| GET    | `/v1/me/services/:id`    | One                                          |
| PATCH  | `/v1/me/services/:id`    | Update                                       |
| DELETE | `/v1/me/services/:id`    | Soft-delete                                  |

**Owner / Admin** (`@Roles('OWNER', 'ADMIN')`):

| Method | Path               | Description                     |
| ------ | ------------------ | ------------------------------- |
| GET    | `/v1/partners`     | Paginated, filterable           |
| GET    | `/v1/partners/:id` | Profile + activeServices joined |

## 5. Data model changes

None — the existing `PartnerProfile` + `Service` scaffolds cover this
slice. KYC moderation of partners is deferred (see §10).

## 6. Permissions

- **PARTNER**: full CRUD on their own profile + own services. The
  `userId` on PartnerProfile is the auth source of truth.
- **OWNER / ADMIN**: read-only on `/v1/partners*`. Inactive
  / soft-deleted profiles are filtered out of the list; detail returns
  404 for soft-deleted.
- **TENANT**: no access in 5.1. (Tenants don't book partners directly.)
- **Self-discovery**: a partner browsing the owner-side endpoints is
  allowed if they have the OWNER role too; the read surface is the same.

Cross-role mutation (e.g. owner POSTing `/v1/me/services`) is gated by
`@Roles('PARTNER')` and returns 403.

## 7. Audit log

None. Profile + service edits are not "sensitive mutations" — they're
business catalog edits, same status as `house.create` or `lease.create`
which we also leave un-audited (per the 3.5 decision). KYC decisions
for partners go through whatever admin-side flow lands next; that path
gets its own audit codes.

## 8. Discovery filter

```sql
SELECT pp.*
FROM "PartnerProfile" pp
JOIN "User" u ON u.id = pp."userId"
WHERE pp."deletedAt" IS NULL
  AND u."isSuspended" = false
  AND u."deletedAt" IS NULL
ORDER BY pp."createdAt" DESC, pp.id DESC
LIMIT $1;
```

KYC status is **shown** on the owner-side projection but not used to
filter — admin moderation of partner KYC isn't built yet, so requiring
it would make the marketplace empty. Owners see the badge and decide.
A KYC-required filter can land in 5.5 (discovery ranking).

## 9. Edge cases

- **PUT `/v1/me/partner-profile` for the first time** → creates the
  row, returns 200 (not 201 — PUT semantics).
- **Repeat PUT** → updates in place; safe to retry.
- **Service create without a profile** → 422 `partners.profile_not_found`.
  The partner must publish their profile before listing services.
- **Service delete on an already-deleted row** → 404
  `partners.service_not_found`.
- **Owner browse with no LIVE partners** → empty page, not 404.
- **Suspended user** — AuthGuard already rejects the request before
  it reaches the service.

## 10. Out of scope

- **Admin moderation of partner KYC** — extends `AdminUsersService` or
  a new partner-specific path in a later slice.
- **Service categories** — flat list for v1; a `Category` model can
  come once we have enough services to justify it.
- **Photo uploads** for partner profile — Phase 5+ storage work.
- **Ratings + ranking** — 5.5.
- **Job lifecycle / booking** — 5.2.
- **Payments / payouts** — 5.4.

## 11. Acceptance criteria

- [x] Partner GET `/v1/me/partner-profile` returns 404 before first PUT.
- [x] Partner PUT creates the profile; second PUT updates it (still 200).
- [x] Partner POST `/v1/me/services` without a profile → 422.
- [x] Partner CRUD on services works; soft-delete filters from own list.
- [x] Owner GET `/v1/partners` returns all non-suspended, non-deleted
      partners; soft-deleted services are excluded from each row.
- [x] Owner GET `/v1/partners/:id` returns 404 for soft-deleted profiles.
- [x] Non-partner POST `/v1/me/services` → 403 `auth.role_mismatch`
      (RolesGuard).
- [x] Non-owner GET `/v1/partners*` → 403 (`OWNER` / `ADMIN` only).

Playwright happy-path test deferred — `apps/e2e` still unscaffolded
(consistent with prior phases). Coverage held by the 9 cases in
`partners.service.spec.ts`.

## 12. Manual test plan

1. Sign in as a partner user; open the partner app `/profile` →
   "No profile yet" → fill the form → see profile.
2. `/services` → add a service ("Plumbing — 1h", $50) → save → it
   appears in the list.
3. Soft-delete the service → no longer in list.
4. Sign in as owner1 → `/partners` → see the partner with one active
   service.
5. Click into the partner → see their profile + active services list.

## 13. Rollout

- No migration. Pure additive endpoints + UI.
- Comms: dev changelog note ("partner directory live; booking lands next").
