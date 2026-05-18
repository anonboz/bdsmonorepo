import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser } from '../auth.types.js';

/**
 * Extracts the authenticated user previously attached to `req.user` by AuthGuard.
 * Throws at the framework level if AuthGuard was bypassed — controllers that
 * use this MUST be gated by AuthGuard.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!req.user) {
      throw new Error('CurrentUser used on a route without AuthGuard.');
    }
    return req.user;
  },
);
