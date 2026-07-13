// @repo/shared/errors — framework-agnostic domain errors shared by every app +
// package, so they all throw and map the same types. Next-coupled helpers
// (NextResponse envelopes) live in each app's lib/api.ts and consume these.

/** Thrown when the caller is authenticated but lacks permission (→ 403). */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Thrown when a resource is missing OR hidden by a tenant-scope check (→ 404). */
export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Thrown on a state conflict — overlapping lease, duplicate row (→ 409). */
export class ConflictError extends Error {
  constructor(message = "Conflict") {
    super(message);
    this.name = "ConflictError";
  }
}

/** Sentinel used by session resolution; the mapper turns it into a 401. */
export const UNAUTHORIZED = "UNAUTHORIZED";

/**
 * String-coded domain errors: services `throw new Error("CODE")` and the app
 * mapper turns the code into an HTTP status + friendly message. Add rows here
 * as features grow so every app maps them identically.
 */
export const DOMAIN_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  PROPERTY_NOT_FOUND: { status: 404, code: "PROPERTY_NOT_FOUND", message: "Property not found" },
  UNIT_NOT_FOUND: { status: 404, code: "UNIT_NOT_FOUND", message: "Unit not found" },
  LEASE_NOT_FOUND: { status: 404, code: "LEASE_NOT_FOUND", message: "Lease not found" },
  LISTING_NOT_FOUND: { status: 404, code: "LISTING_NOT_FOUND", message: "Listing not found" },
  END_BEFORE_START: {
    status: 400,
    code: "END_BEFORE_START",
    message: "Lease end date must be after the start date",
  },
  OVERLAPPING_LEASE: {
    status: 409,
    code: "OVERLAPPING_LEASE",
    message: "This unit already has a lease overlapping those dates",
  },
  UNIT_NOT_AVAILABLE: {
    status: 409,
    code: "UNIT_NOT_AVAILABLE",
    message: "This unit isn't available for a new lease",
  },
  INVALID_INPUT: { status: 400, code: "INVALID_INPUT", message: "The request was invalid" },
};
