# Domain — Documents

`Document` is a generic, org-scoped table keyed by `type` + `entityType` /
`entityId`. Live combinations: `type: "inspection_photo"`, `entityType: "Inspection"`.

## Mutating a `Document` by id asserts org AND type

Any delete/update reached by a `Document` id must assert
`doc.organizationId === session.organizationId && doc.type === <expected type>`.
Create rows with `organizationId` from the session and the expected `type` /
`entityType`.

- Enforced in `removeInspectionPhoto` (`apps/landlord/services/inspection.service.ts`).
- Why it matters: without the type check, a photo route could delete a lease
  agreement (or any other document in the org) by id.
