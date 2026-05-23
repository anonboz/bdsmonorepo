# Spec: Signup hook + user.signed_up analytics (phase 9.5)

> Status: **implemented**
> Phase: 9
> Owner: claude
> Spec last updated: 2026-05-23

## 1. Why

Phase 8.7 wired PostHog and explicitly deferred `user.signed_up` —
the funnel inlet — to a follow-up because it needs a better-auth
post-create hook the auth surface didn't yet have. From the 8.7 spec:

> A `user.signed_up` capture (called from a better-auth
> `databaseHooks.user.create.after` hook) is the natural funnel
> entry point and lands in a follow-up — it needs the auth surface
> to grow a post-signup hook + a small identification dance that's
> out of scope for 8.7.

Phase 9.5 closes that follow-up. After this slice, the PostHog
funnel `user.signed_up → user.signed_in → bill.paid` has a real
inlet event — not the v1 proxy of "first sign-in row per distinct_id".

## 2. User stories

- As **product**, my "signup → first payment" funnel in PostHog
  now starts at the actual moment of account creation, not the
  first session.
- As **legal**, the audit log has a `user.signup` row for every
  new account — same retention path as the `auth.login` / `auth.logout`
  rows from Phase 3.5.
- As a **developer** running locally without `POSTHOG_KEY`, the
  hook still writes the audit row + cleanly no-ops on the PostHog
  capture (the existing singleton handles that).

## 3. Surfaces

| Surface           | App / file                                                | Notes                                                                                                                                                                      |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth hook         | `apps/api/src/auth/better-auth.config.ts`                 | New `databaseHooks.user.create.after` writes audit + captures analytics.                                                                                                   |
| Analytics client  | `apps/api/src/common/analytics/analytics.client.ts` (new) | Module-level `getPostHog()` singleton — same pattern as `getMailer()`. Lets better-auth hooks (which run outside Nest DI) capture without re-implementing singleton logic. |
| Analytics service | `apps/api/src/common/analytics/analytics.service.ts`      | Delegates to `getPostHog()`; keeps the optional-constructor test injection path.                                                                                           |

No schema change, no migration, no shared-type change.

## 4. The hook

```ts
// better-auth.config.ts
databaseHooks: {
  // ...existing session.create / session.delete hooks
  user: {
    create: {
      after: async (user) => {
        // Audit row (best-effort, won't block signup).
        await writeAuthAudit({
          actorId: user.id,
          action: 'user.signup',
          target: `User:${user.id}`,
          meta: {
            via: inferSignupChannel(user),
            // Roles array — empty at signup; an admin assigns later.
            roles: user.roles ?? [],
          },
          ip: null,
          userAgent: null,
        });

        // PostHog capture (no-op when POSTHOG_KEY is unset).
        const ph = getPostHog();
        ph?.capture({
          distinctId: user.id,
          event: 'user.signed_up',
          properties: {
            // Sign-up channel: 'email_otp' or 'magic_link' inferred
            // from the verification record. v1 ships 'email' (both
            // plugins are email-based per Phase 8.1) — we refine
            // later if OAuth lands.
            via: 'email',
            // Roles likely empty at signup; included so the funnel
            // can still filter on `role` even if cohort timing is
            // off by a few minutes vs. the first role assignment.
            role: user.roles ?? [],
          },
        });
      },
    },
  },
},
```

Better-auth's `user.create.after` fires once per new `User` row.
Other create paths (admin-initiated user creation, seeding) don't
go through better-auth and so don't fire the hook — which is correct
for "user signup" semantics.

## 5. Channel inference

V1 sets `via: 'email'` unconditionally — every auth plugin we ship
(emailOTP, magicLink) is email-based. The hook receives the `user`
object but **not** the plugin that triggered it; refining this needs
a join against the Verification table the better-auth Prisma adapter
manages, and that's not worth a roundtrip for a single-value field.

When OAuth or SMS lands, the inference can read from the most-recent
Verification row's `identifier` shape (e.g., `tel:` prefix → SMS).

## 6. Analytics client singleton

The current `AnalyticsService` holds its own `PostHog` instance via
the `@Optional()` constructor pattern from Phase 8.7. That works
inside Nest DI but better-auth hooks run **outside** the container
— calling the service from the hook would either need an explicit
module reference (awkward, requires lifting the hook into a Nest
provider) or a separate code path.

The cleaner shape, mirroring `mailer.client.ts`:

```ts
// apps/api/src/common/analytics/analytics.client.ts (new)
export function getPostHog(): PostHog | null {
  // Cached singleton over env.POSTHOG_KEY — same shape as
  // getMailer().
}

export function resetPostHogForTests(): void {
  // For specs that need to swap the underlying instance.
}
```

`AnalyticsService` is refactored to delegate to `getPostHog()` so
both call paths share the same singleton. The optional-constructor
test injection stays — it just overrides the cached client.

## 7. Edge cases

- **Audit write fails**: caught + logged via the existing
  `writeAuthAudit` shape; signup proceeds. The PostHog capture
  still attempts (independent failure modes).
- **PostHog capture throws**: the `posthog-node` client buffers
  events synchronously and doesn't throw on capture. Worst case
  network down → silently dropped. The audit row is the durable
  record.
- **Re-running on the same user**: better-auth fires `user.create.after`
  exactly once per new row. No idempotency concern.
- **`user.id` is the funnel join key**: the same id is used as the
  PostHog `distinct_id` for `user.signed_in` and `bill.paid`
  events, so a real funnel join works out of the box.

## 8. Permissions

The hook runs inside better-auth, after the framework has already
authorised the request. No additional gate.

## 9. Acceptance criteria

- [ ] `getPostHog()` singleton exists in
      `apps/api/src/common/analytics/analytics.client.ts`.
- [ ] `AnalyticsService` reads from the singleton (constructor
      override still works for tests).
- [ ] `databaseHooks.user.create.after` fires on a new signup, writes
      a `user.signup` audit row and a `user.signed_up` PostHog
      capture with `{ via, role }` properties.
- [ ] When `POSTHOG_KEY` is unset, the audit row still lands; the
      capture is a no-op.
- [ ] Unit specs cover: singleton returns null with no key, returns
      a client with key, audit row written on signup.
- [ ] `pnpm turbo typecheck` / `lint` / `test` clean.

## 10. Manual test plan

1. Set `POSTHOG_KEY` to a sandbox project in `apps/api/.env`.
2. Sign up a fresh user from the tenant app via the email-OTP flow.
3. Verify:
   - PostHog live-events stream shows `user.signed_up` with
     `properties.via === 'email'` and the new user's id as
     `distinct_id`.
   - `AuditLog` has a `user.signup` row targeting `User:<id>`.

## 11. Out of scope

- **Channel refinement** (email_otp vs magic_link vs sms vs oauth).
  v1 ships `via: 'email'`; lands in a polish slice when a non-email
  auth path exists.
- **Backfill of `user.signed_up` for pre-9.5 users**. The funnel
  going forward is what matters; PostHog can be retro-fed via a
  one-off script if a PM asks.
- **`user.signed_up` from a different role's perspective**.
  Signups are role-agnostic at the audit / analytics layer; per-role
  funnel slices happen in PostHog via filtering on the role
  property.

## 12. Rollout

- No DB migration.
- No env additions (`POSTHOG_KEY` already exists since 8.7).
- No feature flag.
