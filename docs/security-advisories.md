# Security advisories

Snapshot of `pnpm audit --prod` findings, with a disposition note for
each so the CI audit job doesn't drown reviewers in noise.

> Last triaged: 2026-05-21
> Source: `pnpm audit --prod` against the locked dependency tree.

## Status legend

| Status   | Meaning                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| tracked  | Real exposure for our deployment. A fix is on the roadmap (see "Next" column for issue/ref). |
| accepted | Either dev-only, behind a feature we don't use, or not reachable from our code path.         |
| fixed    | A new lockfile has the patched version; left here for history.                               |

## Critical

| #   | Package           | Advisory                                                                                                                           | Disposition | Next                                                                                                                                                                       |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `@fastify/middie` | Middleware authentication bypass in child plugin scopes ([GHSA-72c6-fx6q-fr5w](https://github.com/advisories/GHSA-72c6-fx6q-fr5w)) | tracked     | Pulled in by `@nestjs/platform-fastify@10.x`. Closes when we upgrade to NestJS 11 + Fastify 5 (also clears #3, #6, #7, #11, #18, #25 — see below). Scheduled post-Phase 6. |

## High

| #   | Package                    | Advisory                                                                                                                    | Disposition | Next                                                                                   |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| 2   | `lodash`                   | Code injection via `_.template` import key names ([GHSA-35jh-r3h4-6jhm](https://github.com/advisories/GHSA-35jh-r3h4-6jhm)) | accepted    | We never call `_.template`. Transitively from build tooling.                           |
| 3   | `@fastify/middie`          | Middleware bypass via deprecated `ignoreDuplicateSlashes` option                                                            | tracked     | Same upgrade as #1.                                                                    |
| 4   | `fast-uri`                 | Path traversal via percent-encoded dot segments                                                                             | tracked     | Same upgrade — `fast-uri` is a Fastify transitive.                                     |
| 5   | `fast-uri`                 | Host confusion via percent-encoded authority delimiters                                                                     | tracked     | See #4.                                                                                |
| 6   | `glob`                     | Command injection via `-c/--cmd` with `shell:true`                                                                          | accepted    | We never invoke `glob` from the CLI with `--cmd`. Transitively from `@fastify/static`. |
| 7   | `fastify`                  | `Content-Type` header tab character allows body validation bypass                                                           | tracked     | Closed by Fastify 5.7.2. Same upgrade as #1.                                           |
| 8   | `fastify`                  | Memory leak in request abort handling                                                                                       | tracked     | Closed by Fastify 5.7.x.                                                               |
| 9   | `@nestjs/platform-fastify` | URL encoding middleware bypass ([GHSA-r4wm-x892-vjmx](https://github.com/advisories/GHSA-r4wm-x892-vjmx))                   | tracked     | Same upgrade as #1.                                                                    |
| 10  | `@nestjs/platform-fastify` | Header injection via duplicate hostnames                                                                                    | tracked     | Same.                                                                                  |
| 11  | `@nestjs/core`             | Various — bundled platform-fastify peer                                                                                     | tracked     | Same.                                                                                  |

## Moderate / Low

| #     | Package           | Note                                                              | Disposition                                                                                                                            |
| ----- | ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 12-14 | `lodash`          | Prototype pollution via `_.unset`/`_.omit`; ReDoS in `_.template` | accepted (dev-only via build tooling — Next, ESLint plugins). We don't ship lodash to clients.                                         |
| 15-16 | `file-type`       | Buffer over-read via crafted images                               | accepted. Pulled in by `pdfkit` for receipts. We render trusted server-side bills only; no user-provided files go through `file-type`. |
| 17    | `js-yaml`         | Stack overflow on crafted YAML                                    | accepted (dev-only; commitlint config).                                                                                                |
| 18-20 | `webpack`         | DOM clobbering / regex DoS                                        | accepted (build-only; transitive via `@serwist/next`).                                                                                 |
| 21    | `esbuild`         | Loose dev-server CORS allowing arbitrary code execution           | accepted (dev-only; we run dev server bound to `localhost`).                                                                           |
| 22    | `vite`            | Several CVEs in older 5.x                                         | accepted (dev-only; we don't bundle with Vite).                                                                                        |
| 23    | `postcss`         | Line-return parsing                                               | accepted (build-only).                                                                                                                 |
| 24-25 | `glob`/`fast-uri` | duplicates of #4-#6                                               | tracked / accepted (per parent advisory).                                                                                              |

## Planned upgrade — NestJS 11

The bulk of `tracked` items (1, 3-5, 7-11) all clear with a single
upgrade:

- `@nestjs/core` 10.x → 11.x
- `@nestjs/platform-fastify` 10.x → 11.x
- `fastify` 4.x → 5.7.x

This is a major version bump with breaking changes (Fastify 5 drops
`req.routerPath` for `req.routeOptions.url`, request schema shapes
shift). Scheduled as a separate slice once Phase 6 wraps so the
upgrade doesn't entangle with the hardening work.

## CI integration

`.github/workflows/ci.yml` carries an `audit` job that runs
`pnpm audit --prod --json` on every push and uploads the JSON
report as a build artifact. The job is **non-blocking** — the
exit code is ignored — because the existing `tracked` items
would otherwise red the build until the NestJS 11 upgrade lands.

When that upgrade ships, flip the job to fail on `--audit-level=critical`.
