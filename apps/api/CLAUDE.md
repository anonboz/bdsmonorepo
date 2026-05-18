# CLAUDE.md — apps/api

NestJS (Fastify adapter) backend serving all four frontends.

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

## Don't

- Don't read `process.env` directly — use `@repo/config/env`.
- Don't write SQL by hand — use Prisma.
- Don't bypass the global Zod pipe.
- Don't add a new module without copying the `houses` structure.
