import type { Locale, Role } from '@repo/shared';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  roles: Role[];
  isSuspended: boolean;
  /** Phase 11.2 — preferred UI language; mirrored in the `bds-locale` cookie. */
  locale: Locale;
}
