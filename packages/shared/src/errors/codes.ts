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

  // ---- units --------------------------------------------------------
  UNIT_NOT_FOUND: 'units.not_found',
  UNIT_LABEL_TAKEN: 'units.label_taken',
  UNIT_HAS_ACTIVE_LEASE: 'units.has_active_lease',

  // ---- leases -------------------------------------------------------
  LEASE_NOT_FOUND: 'leases.not_found',
  LEASE_INVALID_TRANSITION: 'leases.invalid_transition',
  LEASE_DATES_OVERLAP: 'leases.dates_overlap',
  LEASE_TENANT_INVALID: 'leases.tenant_invalid',

  // ---- bills / payments --------------------------------------------
  BILL_NOT_FOUND: 'bills.not_found',
  BILL_ALREADY_PAID: 'bills.already_paid',
  BILL_LEASE_NOT_ACTIVE: 'bills.lease_not_active',
  BILL_GENERATION_FAILED: 'bills.generation_failed',
  PAYMENT_DECLINED: 'payments.declined',
  PAYMENT_WEBHOOK_INVALID: 'payments.webhook_invalid',

  // ---- tickets ------------------------------------------------------
  TICKET_NOT_FOUND: 'tickets.not_found',
  TICKET_INVALID_TRANSITION: 'tickets.invalid_transition',
  TICKET_REOPEN_WINDOW_EXPIRED: 'tickets.reopen_window_expired',
  TICKET_LEASE_INVALID: 'tickets.lease_invalid',
  TICKET_THREAD_LOCKED: 'tickets.thread_locked',

  // ---- campaigns ----------------------------------------------------
  CAMPAIGN_NOT_FOUND: 'campaigns.not_found',
  CAMPAIGN_NOT_DRAFT: 'campaigns.not_draft',
  CAMPAIGN_INVALID_TRANSITION: 'campaigns.invalid_transition',
  CAMPAIGN_UNIT_NOT_VACANT: 'campaigns.unit_not_vacant',

  // ---- applications -------------------------------------------------
  APPLICATION_NOT_FOUND: 'applications.not_found',
  APPLICATION_CAMPAIGN_NOT_LIVE: 'applications.campaign_not_live',
  APPLICATION_DUPLICATE: 'applications.duplicate',
  APPLICATION_RATE_LIMITED: 'applications.rate_limited',
  APPLICATION_NOT_DECIDABLE: 'applications.not_decidable',
  APPLICATION_SELF: 'applications.self',

  // ---- partners -----------------------------------------------------
  PARTNER_PROFILE_NOT_FOUND: 'partners.profile_not_found',
  PARTNER_PROFILE_ALREADY_EXISTS: 'partners.profile_already_exists',
  PARTNER_SERVICE_NOT_FOUND: 'partners.service_not_found',

  // ---- service jobs -------------------------------------------------
  JOB_NOT_FOUND: 'jobs.not_found',
  JOB_INVALID_TRANSITION: 'jobs.invalid_transition',
  JOB_PARTNER_NOT_BOOKABLE: 'jobs.partner_not_bookable',

  // ---- ratings ------------------------------------------------------
  RATING_NOT_FOUND: 'ratings.not_found',
  RATING_ALREADY_GIVEN: 'ratings.already_given',
  RATING_MILESTONE_LOCKED: 'ratings.milestone_locked',
  RATING_LEASE_INVALID: 'ratings.lease_invalid',

  // ---- admin --------------------------------------------------------
  ADMIN_USER_NOT_FOUND: 'admin.user_not_found',
  ADMIN_USER_ALREADY_IN_STATE: 'admin.user_already_in_state',
  ADMIN_CANNOT_ACT_ON_SELF: 'admin.cannot_act_on_self',
  ADMIN_HOUSE_NOT_FOUND: 'admin.house_not_found',
  ADMIN_HOUSE_ALREADY_IN_STATE: 'admin.house_already_in_state',
  ADMIN_CAMPAIGN_NOT_FOUND: 'admin.campaign_not_found',
  ADMIN_CAMPAIGN_NOT_PENDING: 'admin.campaign_not_pending',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
