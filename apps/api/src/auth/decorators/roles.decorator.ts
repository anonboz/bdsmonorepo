import { SetMetadata } from '@nestjs/common';

import type { Role } from '@repo/shared';

export const ROLES_KEY = Symbol.for('@repo/api:roles');

/**
 * Restricts a route to one or more roles. A user is authorized if *any* of
 * their roles match one of the listed roles.
 *
 *   @Roles('OWNER')                // owner-only
 *   @Roles('OWNER', 'ADMIN')       // owner OR admin
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
