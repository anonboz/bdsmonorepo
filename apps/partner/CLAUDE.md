# CLAUDE.md — apps/partner

Partner PWA — brokers, repair providers, service providers. **Mobile-first.**
Role: `PARTNER`.

## Deployment

Per **ADR-0001**, this PWA ships to `partner.<platform-domain>` as
its own Vercel project; cross-app navigation uses absolute URLs to
the sibling subdomains.

## Surface

- Profile + KYC + service catalog with pricing
- Incoming job requests (from owner ticket or direct booking)
- Quote → accept/decline → status updates → photo proof of work
- Payout ledger (hold / release on completion + cooldown)
- Ratings received

## Rules

- **Mobile-first**, 375px baseline. Partners work in the field — favor large
  tap targets and one-handed flows.
- **PWA:** Serwist service worker; offline queue for status updates pushed when
  back online.
- **Server Components for reads, Client Components for interactivity.**
- **Data via the typed `apiClient`.** Forms via `react-hook-form` +
  `@hookform/resolvers/zod`.
- **Auth gate** rejects non-partner roles with 403.

## Don't

- Don't read `process.env` directly — use `@repo/config/env`.
- Don't allow status transitions that the API rejects — mirror the job
  lifecycle in the client state machine.
