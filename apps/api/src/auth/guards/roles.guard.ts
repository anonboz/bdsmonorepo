import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ErrorCodes, type Role } from '@repo/shared';

import { ProblemError } from '../../common/errors/problem.error.js';
import type { AuthenticatedUser } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Authorizes the request iff the authenticated user has *at least one* of the
 * roles required by `@Roles(...)`. Runs after AuthGuard, so `req.user` is
 * guaranteed populated.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new ProblemError({
        status: 401,
        type: ErrorCodes.AUTH_UNAUTHENTICATED,
        title: 'Unauthenticated',
      });
    }

    const matched = req.user.roles.some((r) => required.includes(r));
    if (!matched) {
      throw new ProblemError({
        status: 403,
        type: ErrorCodes.AUTH_ROLE_MISMATCH,
        title: 'Forbidden',
        detail: `Requires one of: ${required.join(', ')}.`,
      });
    }
    return true;
  }
}
