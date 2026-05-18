# CLAUDE.md — apps/api

NestJS (Fastify adapter) backend serving all four frontends.

## Rules

- **REST under `/v1/*`.** Errors follow RFC 7807 (`application/problem+json`).
- **One Nest module per domain** (`houses`, `bills`, `tickets`, ...). Layout:
  ```
  src/houses/
  ├── dto/                # Zod schemas → re-exported from @repo/shared when shared
  ├── houses.controller.ts
  ├── houses.service.ts
  ├── houses.module.ts
  ├── houses.guard.ts     # ownership guard if applicable
  └── houses.spec.ts      # unit + e2e
  ```
- **The `houses` module is the canonical template.** Mirror its structure for
  every new module. Document any new pattern here as it stabilizes.
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
