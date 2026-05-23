# Spec: Platform config singleton (phase 9.6)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

The platform commission rate has been hardcoded since Phase 5.4:

```ts
// apps/api/src/service-jobs/service-jobs.service.ts
export const PLATFORM_COMMISSION_BPS = 1000; // 10%
```

The Phase 5 spec called it out as "moves to a config table once the
deferred 'fee / commission config' Phase 3.4 item ships". That item
has been deferred from 3.4 to 5 to 8 to 9; nine has the right
combination of admin surface + ledger minting code that no other
slice has been the obvious home.

Phase 9.6 ships a `PlatformConfig` singleton row + admin endpoints
to read and update it. The hot-path `completeForPartner` reads
`commissionBps` from the row on every mint — single-row point read,
no caching needed in v1.

Future config values (payout cooldown, default currency, feature
flags) land in the same row by adding columns.

## 2. User stories

- As an **admin**, I can change the platform commission from 10% to
  12% from `/admin/platform-config`; the next completed job mints
  the partner cut at the new rate.
- As a **partner**, my completed-job email shows the actual
  commission percentage that was applied, not a stale dashboard
  number.
- As an **auditor**, every commission change writes an audit row
  with the previous + next bps and the admin actor.
- As a **developer**, if no `PlatformConfig` row exists at boot
  (fresh install / first migration), the service falls back to the
  defaults baked into the schema — production never starts with a
  missing-row 500.

## 3. Surfaces

| Surface         | App / file                                               | Notes                                                                                                                          |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Schema          | `packages/db/prisma/schema.prisma`                       | New `PlatformConfig` model with literal `id = 'singleton'` default.                                                            |
| Migration       | `packages/db/prisma/migrations/.../`                     | Creates the table AND seeds the single row inline.                                                                             |
| Shared types    | `packages/shared/src/schemas/platform.ts` (new)          | `platformConfigSchema`, `updatePlatformConfigSchema`.                                                                          |
| Config service  | `apps/api/src/platform/platform-config.service.ts`       | `@Global` provider; `get()` returns the singleton (fallback defaults if missing), `update()` writes + audits.                  |
| Service jobs    | `apps/api/src/service-jobs/service-jobs.service.ts`      | `completeForPartner` reads bps from config; `computeCommission(amount, bps)` becomes a pure function with the rate as a param. |
| Admin endpoints | `apps/api/src/admin/admin-platform.controller.ts` (new)  | `GET /v1/admin/platform-config`, `PUT /v1/admin/platform-config`.                                                              |
| Admin UI        | `apps/admin/app/(authed)/platform-config/page.tsx` (new) | Edit form + audit-history link.                                                                                                |
| Error codes     | `packages/shared/src/errors/codes.ts`                    | (No new codes — the existing `validation_failed` covers the Zod bounds check.)                                                 |

## 4. Data model

```prisma
/// Singleton config row. The literal `@default("singleton")` id +
/// the `@id` constraint mean Prisma will refuse a second insert,
/// and Postgres enforces the same via the PK. Reads always hit the
/// row by id; writes are upserts so the "fresh install with no row"
/// case resolves on the first PUT.
model PlatformConfig {
  id String @id @default("singleton")

  /// Commission rate in basis points. 1000 = 10%. Bounds enforced
  /// at the Zod layer (0..5000 = 0..50%) — anything outside that
  /// range almost certainly indicates a mistake.
  commissionBps Int @default(1000)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Migration: `platform_config`. Creates the table, inserts the
singleton row with default values inline so the first deploy is
self-bootstrapping.

## 5. API

```ts
// packages/shared/src/schemas/platform.ts

export const platformConfigSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000),
  updatedAt: isoDateTimeSchema,
});
export type PlatformConfig = z.infer<typeof platformConfigSchema>;

export const updatePlatformConfigSchema = z.object({
  commissionBps: z.number().int().min(0).max(5000),
});
export type UpdatePlatformConfigInput = z.infer<typeof updatePlatformConfigSchema>;
```

| Method | Path                        | Roles | Description                                                       |
| ------ | --------------------------- | ----- | ----------------------------------------------------------------- |
| GET    | `/v1/admin/platform-config` | ADMIN | Returns the current config singleton.                             |
| PUT    | `/v1/admin/platform-config` | ADMIN | Upserts; writes an audit row capturing `previousBps` + `nextBps`. |

Bounds: `commissionBps ∈ [0, 5000]` (i.e. 0–50%). Anything outside
is rejected at the Zod boundary as `validation_failed`. The lower
bound being 0 (not 1) lets ops temporarily zero out commissions for
testing / promo periods.

## 6. Service shape

```ts
// apps/api/src/platform/platform-config.service.ts

@Injectable()
export class PlatformConfigService {
  async get(): Promise<PlatformConfig>;
  async update(input: UpdatePlatformConfigInput, ctx: RequestContext): Promise<PlatformConfig>;
}
```

`get()` reads the singleton row; if the row's missing (shouldn't
happen post-migration but defensive against bad seeds), returns a
synthetic `{ commissionBps: 1000, updatedAt: now }` — the schema's
default. No throw on missing row.

`update()` runs in a `$transaction`: upsert the row, write an
`platform.config.update` audit row carrying `previousBps` + `nextBps`.

## 7. Service-jobs rewire

```ts
// service-jobs.service.ts (completeForPartner)
const config = await this.platformConfig.get();
const commission = computeCommission(finalAmount, config.commissionBps);
```

`computeCommission` becomes `computeCommission(amount, bps)`. The
existing single-arg form gets removed. Callers (service + spec) pass
the bps explicitly — making the call site read like the policy it
implements.

## 8. Permissions

- `@Roles('ADMIN')` on both endpoints.
- `assertNotSelf` doesn't apply (no user target).
- All admins can edit; v1 doesn't gate on "super-admin" sub-roles.

## 9. Edge cases

- **Concurrent updates**: last-write wins. Upserts are atomic and
  both audit rows land. No "merge editor" semantics in v1.
- **Mid-job mints during an update**: ServiceJobsService reads the
  config inside the same `$transaction` it mints the ledger in. A
  concurrent admin update can land between the SELECT and the
  audit write but the ledger row is already committed at the
  read-time rate. That's the right "atomic per job" semantics.
- **Existing already-minted rows on rate change**: stay at the old
  rate. We never retro-mint. Auditor can join the ledger row's
  createdAt against the audit log of config changes to recover the
  active rate at any historical moment.
- **Fresh-install with no migration applied**: the get() fallback
  returns the schema default so the service boots. The first
  `update()` creates the real row.

## 10. Acceptance criteria

- [ ] `PlatformConfig` table created via `platform_config`
      migration with one singleton row at default values.
- [ ] `PlatformConfigService` exists with `get()` + `update()`;
      `get()` falls back to schema defaults when the row is missing.
- [ ] `GET /v1/admin/platform-config` returns the row.
- [ ] `PUT /v1/admin/platform-config` writes the row + an audit
      entry; clamps `commissionBps` to `[0, 5000]`.
- [ ] `ServiceJobsService.completeForPartner` reads bps from the
      config; `computeCommission` takes bps as a required param.
- [ ] An admin can edit the rate from `/admin/platform-config`.
- [ ] Unit specs cover: singleton get + update; computeCommission
      with the bps param; ServiceJobsService uses the configured
      rate.

## 11. Manual test plan

1. Boot a fresh DB; run migrations.
2. From `/admin/platform-config`, change commission from 10% to 12%.
3. Audit log shows `platform.config.update` with
   `{ previousBps: 1000, nextBps: 1200 }`.
4. Complete a partner job via the existing flow.
5. Confirm the partner cut + commission line up to the new rate.

## 12. Out of scope

- **Payout cooldown configurability** — still a constant in v1.
  Trivial to lift into the same singleton row when ops asks.
- **Per-house / per-region commission rates** — the row is global.
  Per-tenant carve-outs are a much bigger surface (lease
  attribute, partner-profile carve-out, etc.) and explicitly
  deferred.
- **Currency / locale config** — same singleton can grow it; v1
  doesn't need it.
- **Effective-from / scheduled changes** — v1 applies immediately
  on update. Scheduled rate changes can land later via a versioned
  config history table.

## 13. Rollout

- Forward-only migration; the `INSERT` lands inline.
- No env additions.
- No feature flag.
