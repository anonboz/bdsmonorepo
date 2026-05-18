import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes, type Role } from '@repo/shared';

import { ProblemError } from '../../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../../common/prisma/prisma.token.js';
import { auth } from '../better-auth.config.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../auth.types.js';

/**
 * Validates the better-auth session cookie, looks up the user, and attaches
 * an `AuthenticatedUser` to `req.user`. Rejects suspended accounts. Runs on
 * every route unless `@Public()` is set.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest & { user?: AuthenticatedUser }>();

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      headers.append(k, Array.isArray(v) ? v.join(', ') : String(v));
    }

    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      throw new ProblemError({
        status: 401,
        type: ErrorCodes.AUTH_UNAUTHENTICATED,
        title: 'Unauthenticated',
        detail: 'No valid session cookie.',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        phone: true,
        displayName: true,
        roles: true,
        isSuspended: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new ProblemError({
        status: 401,
        type: ErrorCodes.AUTH_UNAUTHENTICATED,
        title: 'Unauthenticated',
        detail: 'User not found.',
      });
    }

    if (user.isSuspended) {
      throw new ProblemError({
        status: 403,
        type: ErrorCodes.AUTH_ACCOUNT_SUSPENDED,
        title: 'Account suspended',
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      displayName: user.displayName,
      roles: user.roles as Role[],
      isSuspended: user.isSuspended,
    };

    return true;
  }
}
