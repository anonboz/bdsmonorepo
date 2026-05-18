import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { MeResponse } from '@repo/shared';

import { CurrentUser } from './decorators/current-user.decorator.js';
import { AuthGuard } from './guards/auth.guard.js';
import type { AuthenticatedUser } from './auth.types.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  @Get()
  me(@CurrentUser() user: AuthenticatedUser): MeResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.displayName,
        roles: user.roles,
        isSuspended: user.isSuspended,
      },
      // Session expiry is enforced by better-auth's cookie; this echoes a
      // reasonable client hint. The cookie is the source of truth.
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}
