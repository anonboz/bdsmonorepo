// House-renting monorepo — apps/<app>/lib/api.ts
//
// The shared API surface for route handlers: the response envelope helpers,
// the small domain-error class set, and the central error mapper. Mirrors the
// reference project's lib/api-error.ts, trimmed to a starter.

import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ── Response envelope ────────────────────────────────────────────────────────
// { success: true, data } | { success: false, error: { code, message } }

export function apiSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

export function apiError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

// ── Domain error classes ─────────────────────────────────────────────────────
// In the real repo these live in @repo/shared so every app + package throws the
// same types. Kept here to make the slice self-contained.

export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}

// ── String-coded domain errors ───────────────────────────────────────────────
// Services `throw new Error("CODE")`; the mapper turns the code into an HTTP
// status + friendly message. Add rows as you add features.

const DOMAIN_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  UNIT_NOT_FOUND:    { status: 404, code: "UNIT_NOT_FOUND",    message: "Unit not found" },
  LEASE_NOT_FOUND:   { status: 404, code: "LEASE_NOT_FOUND",   message: "Lease not found" },
  END_BEFORE_START:  { status: 400, code: "END_BEFORE_START",  message: "Lease end date must be after the start date" },
  OVERLAPPING_LEASE: { status: 409, code: "OVERLAPPING_LEASE", message: "This unit already has a lease overlapping those dates" },
  UNIT_NOT_AVAILABLE:{ status: 409, code: "UNIT_NOT_AVAILABLE",message: "This unit isn't available for a new lease" },
  INVALID_INPUT:     { status: 400, code: "INVALID_INPUT",     message: "The request was invalid" },
};

// ── withErrorHandler wrapper ─────────────────────────────────────────────────

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (req: Request, ctx: RouteContext) => Promise<NextResponse>;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      return handleRouteError(err, "Something went wrong");
    }
  };
}

// ── Central mapper ───────────────────────────────────────────────────────────

export function handleRouteError(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof ZodError) {
    return apiError("VALIDATION_ERROR", err.issues[0]?.message ?? "Validation failed", 400);
  }
  if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message || "Forbidden", 403);
  if (err instanceof NotFoundError) return apiError("NOT_FOUND", err.message || "Not found", 404);
  if (err instanceof ConflictError) return apiError("CONFLICT", err.message || "Conflict", 409);

  if (err instanceof Error) {
    if (err.message === "UNAUTHORIZED") return apiError("UNAUTHORIZED", "Unauthorized", 401);

    // Prisma unique / not-found
    const code = (err as { code?: string }).code;
    if (code === "P2002") return apiError("CONFLICT", "A record with this data already exists", 409);
    if (code === "P2025") return apiError("NOT_FOUND", "Record not found", 404);

    // String-coded domain errors
    const mapped = DOMAIN_ERROR_MAP[err.message];
    if (mapped) return apiError(mapped.code, mapped.message, mapped.status);
  }

  console.error("[handleRouteError]", err);
  return apiError("SERVER_ERROR", fallbackMessage, 500);
}
