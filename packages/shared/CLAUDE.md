# CLAUDE.md — @repo/shared

Zod schemas, TypeScript types, enums, error codes, constants — shared between
the API and the four frontends.

## Rules

- **Single source of truth for API I/O shapes.** Don't redefine a request or
  response type in an app or in `apps/api/src/**/dto.ts`. Import it from here.
- **No runtime dependencies on Node or DOM.** Must run in browser, server, and
  edge. No `fs`, no `process`, no `window`.
- **Enums mirror Prisma enums** (`packages/db/prisma/schema.prisma`). When you
  change one, change both.
- **Error codes** are string constants here. The API filter maps them to RFC
  7807 `application/problem+json` responses.

## Layout

```
src/
├── enums/          # Role, BillStatus, TicketStatus, JobStatus, ...
├── schemas/        # one file per domain (houses.ts, bills.ts, ...)
├── errors/         # error code constants + Problem schema
└── index.ts        # barrel
```

## When to add a schema

When an API endpoint exposes a new request or response shape. Define the schema
here, then `import { fooSchema } from '@repo/shared'` in both the API DTO and the
frontend form.
