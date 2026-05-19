import { Controller, Get, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { ErrorCodes, type Role, type UserLookup } from '@repo/shared';

import { Roles } from '../auth/decorators/roles.decorator.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';

/**
 * Minimal user-lookup endpoint for picker UIs (lease form, etc.). Returns
 * just enough to render a confirmation — not the full user record. Owner +
 * Admin scope; tenants don't need to look up other users in this phase.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaInstance) {}

  @Get('find')
  @Roles('OWNER', 'ADMIN')
  async find(@Query('email') email?: string, @Query('role') role?: Role): Promise<UserLookup> {
    if (!email) {
      throw new ProblemError({
        status: 422,
        type: ErrorCodes.VALIDATION_FAILED,
        title: 'Email is required',
        errors: { email: ['email query parameter is required'] },
      });
    }

    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: {
        id: true,
        displayName: true,
        email: true,
        roles: true,
        isSuspended: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.NOT_FOUND,
        title: 'User not found',
      });
    }
    if (role && !user.roles.includes(role)) {
      throw new ProblemError({
        status: 404,
        type: ErrorCodes.NOT_FOUND,
        title: 'User not found with that role',
      });
    }

    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      roles: user.roles,
      isSuspended: user.isSuspended,
    };
  }
}
