# design-sync notes — @repo/ui

Repo-specific gotchas for future re-syncs of this design system.

- **No build / no `dist/`.** `@repo/ui` ships raw `.tsx`; `package.json` `build`
  is `tsc --noEmit`. `exports["."]` points at `./src/index.ts`, so the converter
  resolves the **real barrel** as the esbuild entry directly (not weak synth-entry).
  No `--entry` flag needed.
- **pnpm monorepo.** `npm i --no-save` fails on `workspace:*` deps. Install the
  converter's build deps with `pnpm add -D esbuild ts-morph` instead (revert the
  `package.json`/lockfile change after building — it's tooling-only).
- **Tailwind styling must be precompiled.** shadcn components style via Tailwind
  utility classes; `src/styles/globals.css` only has `@tailwind` directives +
  token vars (unstyled in a browser). Before each sync, compile a static CSS:
  `node <repo>/node_modules/.pnpm/tailwindcss@*/node_modules/tailwindcss/lib/cli.js \
    -c tailwind.config.ts -i src/styles/globals.css -o .design-sync/compiled.css`
  and keep `cfg.cssEntry` pointed at `.design-sync/compiled.css`. The `tailwindcss`
  bin isn't linked into `packages/ui/node_modules/.bin`; it lives under
  `packages/config`/the pnpm store.
- Tailwind preset (color tokens → `hsl(var(--*))`) lives in
  `packages/config/tailwind/preset.ts`.
