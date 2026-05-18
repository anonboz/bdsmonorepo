import type { Role } from '@repo/shared';

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  roles: Role[];
  isSuspended: boolean;
}
