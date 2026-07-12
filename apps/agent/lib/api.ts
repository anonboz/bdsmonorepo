// Next-coupled API surface for route handlers: the response-envelope helpers and
// the central error mapper. Domain error classes + the code map are shared in
// @repo/shared so every app maps identically.

import {
  ConflictError,
  DOMAIN_ERROR_MAP,
  ForbiddenError,
  NotFoundError,
  UNAUTHORIZED,
} from "@repo/shared";
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

// ── Central mapper ───────────────────────────────────────────────────────────

export function handleRouteError(err: unknown, fallbackMessage: string): NextResponse {
  if (err instanceof ZodError) {
    return apiError("VALIDATION_ERROR", err.issues[0]?.message ?? "Validation failed", 400);
  }
  if (err instanceof ForbiddenError) return apiError("FORBIDDEN", err.message || "Forbidden", 403);
  if (err instanceof NotFoundError) return apiError("NOT_FOUND", err.message || "Not found", 404);
  if (err instanceof ConflictError) return apiError("CONFLICT", err.message || "Conflict", 409);

  if (err instanceof Error) {
    if (err.message === UNAUTHORIZED) return apiError("UNAUTHORIZED", "Unauthorized", 401);

    // Prisma unique / not-found
    const code = (err as { code?: string }).code;
    if (code === "P2002")
      return apiError("CONFLICT", "A record with this data already exists", 409);
    if (code === "P2025") return apiError("NOT_FOUND", "Record not found", 404);

    // String-coded domain errors
    const mapped = DOMAIN_ERROR_MAP[err.message];
    if (mapped) return apiError(mapped.code, mapped.message, mapped.status);
  }

  console.error("[handleRouteError]", err);
  return apiError("SERVER_ERROR", fallbackMessage, 500);
}
