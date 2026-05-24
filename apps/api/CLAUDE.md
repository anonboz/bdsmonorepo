# CLAUDE.md — apps/api

NestJS (Fastify adapter) backend serving all four frontends.

## Deployment topology

Per **ADR-0001**, production runs each PWA + the API on its own
subdomain of the platform domain (placeholder
`{admin,owner,tenant,partner,api}.bdsmonorepo.vn`). Cookie scope is
the parent domain (`.bdsmonorepo.vn`) via `AUTH_COOKIE_DOMAIN`; CORS
allow-list (`API_CORS_ORIGINS`) lists the four PWA subdomain origins
explicitly. See `apps/api/.env.example` for the canonical env shape.

## Rules

- **REST under `/v1/*`.** Errors follow RFC 7807 (`application/problem+json`).
- **One Nest module per domain** (`houses`, `bills`, `tickets`, ...). Layout:
  ```
  src/houses/
  ├── dto/houses.dto.ts        # createZodDto() wrappers around @repo/shared schemas
  ├── houses.controller.ts     # thin — HTTP ↔ service calls
  ├── houses.service.ts        # business rules + ownership/authorization
  ├── houses.module.ts
  └── houses.service.spec.ts   # unit; e2e in test/houses.e2e.spec.ts
  ```
- **The `houses` module is the canonical template.** Mirror its structure for
  every new module. Document any new pattern here as it stabilizes.

### Canonical patterns (from `houses`)

- **DTOs:** define the schema in `@repo/shared/schemas/<domain>.ts`; wrap with
  `createZodDto()` in `dto/<domain>.dto.ts`. The global `ZodValidationPipe`
  reads the schema off the DTO class metadata.
- **Auth:** routes are gated globally by `AuthGuard` (skip with `@Public()`)
  and `RolesGuard` (`@Roles('OWNER')`, `@Roles('OWNER', 'ADMIN')`).
- **Ownership:** lives in the service, not in a guard — services need DB access
  to check `ownerId`. Return `404 NOT_FOUND` (not `403`) when an actor accesses
  someone else's resource, so we don't leak existence.
- **Pagination:** cursor-based on `id` ordered by `createdAt`. `limit` ≤ 100.
  Response: `{ items, nextCursor }`. Schema helper: `pageSchema(itemSchema)`.
- **Soft delete:** set `deletedAt`. All reads filter `deletedAt: null` unless
  an admin explicitly opts in.
- **Errors:** throw `ProblemError`. The global filter converts to RFC 7807.
  Reuse codes from `@repo/shared`'s `ErrorCodes`; add new ones there when
  needed.
- **All DTOs are Zod schemas** in `@repo/shared`. Validate at the boundary using
  the global Zod pipe. Never hand-roll validation in a controller.
- **`@Roles()` guard** on every authenticated route. Ownership guards layered on
  top for resource-scoped access (an owner only sees their own houses).
- **Swagger at `/docs`** (dev only).
- **Pino logger** with request id + user id correlation.

## Workers

BullMQ workers live alongside the API process in dev, separate in prod. Queues:

- `bills.generate` — recurring bill generation
- `notifications.send` — email + push + in-app
- `webhooks.payments` — Stripe / VNPay webhook reconciliation

## Notifications

The `NotificationsService.dispatch` return shape is contractual:
`{ id: string | null; enqueue: () => Promise<void>; muted: boolean }`.
~7 callers destructure these three keys; widening or narrowing silently
breaks the audit-log paths.

When dispatch suppresses a channel (e.g. `scope=EMAIL muted=true`), the
persisted `Notification` row needs `failureReason` set. The stuck-notifications
sweeper filter is `sentAt IS NULL AND failureReason IS NULL` — without one
of those, the sweeper retries the row 3× then finalizes. Pure wasted work.

## Audit log

Sweepers acting on a user's own behalf (delayed account erasure, etc.) set
`actorId = userId`, not `null`. Reserve `actorId: null` for actions no user
ever initiated (e.g. daily payouts release on elapsed cooldown).

## Testing

Service interfaces stubbable in tests should use property syntax
(`foo: (x) => Promise<T>`), not method-shorthand (`foo(x): Promise<T>`).
Method-shorthand declares the method `this`-bound, which trips
`@typescript-eslint/unbound-method` on `expect(stub.foo).toHaveBeenCalled()`.

## Don't

- Don't read `process.env` directly — use `@repo/config/env`.
- Don't write SQL by hand — use Prisma.
- Don't bypass the global Zod pipe.
- Don't add a new module without copying the `houses` structure.
