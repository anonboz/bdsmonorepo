# CLAUDE.md — apps/admin

Admin web app. **Desktop-first.** Role: `ADMIN`.

## Deployment

Per **ADR-0001**, this PWA ships to `admin.<platform-domain>` as its
own Vercel project. Admin is the most sensitive surface, so the
subdomain isolation also gives it room for a stricter CSP /
observability scope without affecting the consumer-facing apps.

## Surface

- System config (fees, commissions, feature flags)
- KYC review (users, owners, partners)
- House & campaign moderation queues
- Audit log viewer
- Platform dashboards (active users, GMV, overdue, SLA)

## Rules

- **Server Components for reads, Client Components for interactivity.**
- **Data via the typed `apiClient`** (`app/lib/api.ts`). No raw `fetch` to the
  API in components.
- **Forms:** `react-hook-form` + `@hookform/resolvers/zod` against the schema
  from `@repo/shared`.
- **Route segments mirror navigation** (`/users`, `/users/[id]`,
  `/users/[id]/kyc`).
- **Auth gate at the layout level** — redirect to `/login` if no session;
  reject non-admin roles with 403.
- **Component re-use:** primitives from `@repo/ui`; admin-specific composites
  stay here.
- **English-only for v1.** Admin does not import `@repo/i18n` strings; UI
  labels stay inline English. Flip when a non-English-speaking operator joins.

## Don't

- Don't ship admin-only screens to the other apps.
- Don't read `process.env` directly — use `@repo/config/env`.
- Don't add desktop-only features without considering >=1024px breakpoints
  first.
