# CLAUDE.md — @repo/ui

shadcn/ui-based component library shared by all four frontend apps.

## Rules

- **No business logic.** Components here are presentation primitives — buttons,
  inputs, dialogs, tables, layout shells. Per-domain components live in the app
  that uses them.
- **No API calls.** Components receive data via props and emit events via
  callbacks. Data fetching lives in the app.
- **Mobile-first.** Owner/tenant/partner apps are mobile-first PWAs. Anything
  shipped from here renders correctly at 375px.
- **Tailwind only.** No styled-components, no emotion, no CSS modules. Use the
  `@repo/config/tailwind` preset.
- **Accessibility:** keyboard navigable, ARIA where required, contrast meets
  WCAG AA.

## When to promote a component to @repo/ui

The third app needs it. Two-app duplication is fine; three is a signal.

## Layout

```
src/
├── components/     # one file per primitive
├── hooks/          # shared hooks (useMediaQuery, ...)
├── styles/         # globals.css with the design tokens
└── index.ts        # barrel
```
