/**
 * Stable, machine-readable error codes returned in the `type` slug of a
 * Problem response. Add a new code whenever the API needs to communicate a
 * new failure mode that a client must branch on.
 *
 * Format: `auth.invalid_otp` — domain.snake_case_reason.
 */
export const ErrorCodes = {
  // ---- generic ------------------------------------------------------
  VALIDATION_FAILED: 'common.validation_failed',
  INTERNAL_ERROR: 'common.internal_error',
  NOT_FOUND: 'common.not_found',
  RATE_LIMITED: 'common.rate_limited',
  CONFLICT: 'common.conflict',

  // ---- auth ---------------------------------------------------------
  AUTH_UNAUTHENTICATED: 'auth.unauthenticated',
  AUTH_FORBIDDEN: 'auth.forbidden',
  AUTH_INVALID_OTP: 'auth.invalid_otp',
  AUTH_INVALID_MAGIC_LINK: 'auth.invalid_magic_link',
  AUTH_OTP_EXPIRED: 'auth.otp_expired',
  AUTH_ACCOUNT_SUSPENDED: 'auth.account_suspended',
  AUTH_ROLE_MISMATCH: 'auth.role_mismatch',

  // ---- houses -------------------------------------------------------
  HOUSE_NOT_FOUND: 'houses.not_found',
  HOUSE_NOT_OWNED: 'houses.not_owned',
  HOUSE_HAS_ACTIVE_UNITS: 'houses.has_active_units',

  // ---- bills / payments --------------------------------------------
  BILL_NOT_FOUND: 'bills.not_found',
  BILL_ALREADY_PAID: 'bills.already_paid',
  PAYMENT_DECLINED: 'payments.declined',
  PAYMENT_WEBHOOK_INVALID: 'payments.webhook_invalid',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
