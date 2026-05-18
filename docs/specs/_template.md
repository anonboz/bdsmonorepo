# Spec: <feature-name>

> Status: **draft** | review | approved | shipped
> Phase: <0-6>
> Owner: <name>
> Spec last updated: YYYY-MM-DD

## 1. Why

One paragraph. What problem does this solve, for whom, and why now?

## 2. User stories

- As a `<role>`, I want `<capability>` so that `<outcome>`.
- ...

## 3. Screens / surfaces

List the screens or API surfaces this touches. Wireframes / Figma links if any.

| Surface | App | Route | Notes |
| ------- | --- | ----- | ----- |
|         |     |       |       |

## 4. API shape

```ts
// Request / response schemas (will live in @repo/shared)
```

Endpoints:

| Method | Path | Role(s) | Description |
| ------ | ---- | ------- | ----------- |
|        |      |         |             |

## 5. Data model changes

```prisma
// New / changed models, fields, enums, indices
```

Migration name: `<slug>`

## 6. Workers / jobs

Any BullMQ jobs added or modified. Triggers, idempotency, retry policy.

## 7. Permissions

Which roles can do what. Ownership rules. New `@Roles()` decorators.

## 8. Edge cases

- ...

## 9. Out of scope

What this spec deliberately does *not* cover, with a pointer to where it will be
covered if known.

## 10. Acceptance criteria

- [ ] ...
- [ ] ...

## 11. Manual test plan

Step-by-step a human can run to verify in a preview environment.

## 12. Rollout

- Feature flag? (name + default)
- Migration order
- Backfill required?
- Comms (admin, owners, tenants)?
