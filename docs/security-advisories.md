# Security advisories

Snapshot of `pnpm audit --prod` findings, with a disposition note for
each so the CI audit job doesn't drown reviewers in noise.

> Last triaged: 2026-05-22 (post NestJS 11 + Fastify 5 upgrade — phase 8.5)
> Source: `pnpm audit --prod` against the locked dependency tree.

## Status legend

| Status   | Meaning                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| tracked  | Real exposure for our deployment. A fix is on the roadmap (see "Next" column for issue/ref). |
| accepted | Either dev-only, behind a feature we don't use, or not reachable from our code path.         |
| fixed    | A new lockfile has the patched version; left here for history.                               |

## Critical

_None._ The `@fastify/middie` (#1) advisory closed with the Phase 8.5
NestJS 11 + Fastify 5 upgrade — `@fastify/middie` is no longer a
transitive of `@nestjs/platform-fastify@11`.

## High

_None._ Items #3-#5, #7-#11 all closed via the same upgrade. See the
[Phase 8.5 spec](specs/phase8-nest-fastify-upgrade.md) and commit log.

## Moderate / Low

| #   | Package     | Note                                                              | Disposition                                                                                                                            |
| --- | ----------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 12  | `lodash`    | Prototype pollution via `_.unset`/`_.omit`; ReDoS in `_.template` | accepted (dev-only via build tooling — Next, ESLint plugins). We don't ship lodash to clients.                                         |
| 13  | `file-type` | Buffer over-read via crafted images                               | accepted. Pulled in by `pdfkit` for receipts. We render trusted server-side bills only; no user-provided files go through `file-type`. |
| 14  | `js-yaml`   | Stack overflow on crafted YAML                                    | accepted (dev-only; commitlint config).                                                                                                |
| 15  | `webpack`   | DOM clobbering / regex DoS                                        | accepted (build-only; transitive via `@serwist/next`).                                                                                 |
| 16  | `esbuild`   | Loose dev-server CORS allowing arbitrary code execution           | accepted (dev-only; vitest transitive — we don't bundle with esbuild).                                                                 |
| 17  | `vite`      | Path traversal in dev-server `.map` handling                      | accepted (dev-only; vitest transitive).                                                                                                |
| 18  | `postcss`   | XSS via unescaped `</style>` in CSS stringify output              | accepted (build-only; Next.js transitive).                                                                                             |

## Phase 8.5 — what changed

The phase 8.5 upgrade flipped the following from `tracked` to `fixed` /
removed:

| #         | Was                                                              | Status                          |
| --------- | ---------------------------------------------------------------- | ------------------------------- |
| 1         | `@fastify/middie` auth bypass in child plugin scopes             | fixed                           |
| 3         | `@fastify/middie` middleware bypass via deprecated option        | fixed                           |
| 4, 5      | `fast-uri` path traversal + host confusion                       | fixed                           |
| 7, 8      | `fastify` content-type tab + memory leak                         | fixed                           |
| 9, 10     | `@nestjs/platform-fastify` URL encoding + duplicate hostnames    | fixed                           |
| 11        | `@nestjs/core` bundled platform-fastify peer issues              | fixed                           |
| (new ack) | `@fastify/static` route-guard bypass via encoded path separators | fixed (`@fastify/static@9.1.1`) |

The `lodash` and `glob` items previously listed under High in the
pre-8.5 doc never affected runtime — both were accepted dev-only and
have been collapsed into the Moderate / Low table above.

## CI integration

`.github/workflows/ci.yml` carries an `audit` job that runs
`pnpm audit --prod --audit-level=critical` on every push. Post-8.5
this job is **blocking** — the exit code now gates the workflow.
Re-introducing a critical advisory fails the build.

The full `pnpm audit --prod --json` report is still uploaded as a
build artifact so reviewers can see what's flagged at any severity.

When future moderate advisories warrant action (e.g. a postcss patch
that doesn't pull in a Next.js major bump), update this doc and bump
the package; no CI flip needed.
