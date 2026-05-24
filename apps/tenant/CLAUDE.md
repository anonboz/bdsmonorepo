# CLAUDE.md — apps/tenant

Tenant PWA. **Mobile-first.** Role: `TENANT`.

## Deployment

Per **ADR-0001**, this PWA ships to `tenant.<platform-domain>` as its
own Vercel project; cross-app navigation uses absolute URLs to the
sibling subdomains.

## Surface

- View current and historical bills, download receipts
- Pay bills (Stripe in v1, VNPay later)
- Raise reports / repair tickets with photos
- Chat thread on each ticket
- Rate owner at lease milestones
- Browse public campaigns (pre-login marketing surface)
- Apply to a campaign (basic profile + ID upload)

## Rules

- **Mobile-first**, 375px baseline.
- **PWA:** Serwist service worker; offline cache for bill history + receipts.
- **Public campaign browsing** must work without login (SSR, indexable).
  Application flow gates on auth.
- **Server Components for reads, Client Components for interactivity.**
- **Data via the typed `apiClient`.** Forms via `react-hook-form` +
  `@hookform/resolvers/zod`.
- **Auth gate** rejects non-tenant roles with 403, except on the public
  campaign routes.

## Don't

- Don't read `process.env` directly — use `@repo/config/env`.
- Don't put owner-side actions in the tenant UI.
