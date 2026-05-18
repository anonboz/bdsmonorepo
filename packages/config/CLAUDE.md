# CLAUDE.md — @repo/config

Shared toolchain config: TypeScript presets, ESLint flat configs, Prettier preset,
Tailwind preset, Zod-validated env loader.

## Rules

- This package is **toolchain only**. No runtime app code, no business logic.
- Configs are consumed by every app/package — changes ripple. Treat as a public
  API: bump intentionally, document breakage.
- Keep TypeScript and ESLint variants minimal — one per consumer kind
  (`base`, `node`, `react`, `nextjs`). Don't fork per app.
- The env loader (`env/index.ts`) is the **only** sanctioned way to read
  `process.env` in app code. If you need a new validator helper, add it here.

## When to add something

- New shared TypeScript flag → edit `tsconfig/base.json` (and root
  `tsconfig.base.json` if it's a true language default).
- New shared ESLint rule → `eslint/base.js`. React/Next-only → the more specific
  file.
- New env helper (e.g., a new URL kind) → add to `env/index.ts`, export.

## When NOT to add something

- App-specific config — keep it in the app.
- One-off scripts — `apps/*/scripts/` is fine.
