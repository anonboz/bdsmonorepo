# CLAUDE.md — apps/owner

Owner PWA. **Mobile-first.** Role: `OWNER`.

## Surface

- Houses, Units, Leases CRUD
- Bills: generate, view, mark paid offline
- Tickets: respond, schedule repairs, book partners
- Campaigns: create, edit, close vacant-unit listings
- Partner marketplace: search, book, rate
- Owner dashboard: occupancy, MRR, overdue, recent payments

## Rules

- **Mobile-first**, 375px baseline. Test every screen on a phone-sized viewport.
- **PWA:** Serwist service worker, installable, offline fallback for read views.
- **Server Components for reads, Client Components for interactivity.**
- **Data via the typed `apiClient`.** Forms via `react-hook-form` +
  `@hookform/resolvers/zod`.
- **Auth gate** rejects non-owner roles with 403.
- **Component re-use:** primitives from `@repo/ui`; owner-specific composites
  stay here.

## Don't

- Don't read `process.env` directly — use `@repo/config/env`.
- Don't ship desktop-only layouts. If a feature needs a wider screen, design
  the mobile version first.
