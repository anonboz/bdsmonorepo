// @repo/shared — framework-agnostic types, errors, and helpers shared across
// apps + packages. No React, no Next, no Prisma runtime imports here.

export * from "./errors";
export * from "./money";

/** The API response envelope every route handler returns. */
export type ApiSuccess<T> = { success: true; data: T };
export type ApiFailure = { success: false; error: { code: string; message: string } };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
