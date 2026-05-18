# CLAUDE.md — apps/e2e

Playwright end-to-end suites covering the four PWAs + API.

## Rules

- **One happy-path test per feature**, minimum. Edge cases live in unit tests.
- **Cross-app flows** belong here (e.g., owner posts campaign → admin approves
  → tenant applies → owner accepts). Single-app flows can live here too if
  they're critical (login, pay bill).
- **Real API + DB** during e2e — use `pnpm db:reset` + seed before each suite.
  No mocking the backend.
- **No flakes.** A flaky test gets quarantined or fixed within the same PR.
- **Selectors:** prefer `getByRole` / `getByLabel` / `getByTestId`. Avoid CSS
  selectors tied to Tailwind classes.

## Critical flows (Phase 6 must-have)

- Login for each role
- Owner pays bill end-to-end
- Tenant raises ticket → owner resolves → tenant rates
- Owner posts campaign → admin approves → tenant applies → owner accepts
- Owner books partner → partner completes → settlement + ledger entries
