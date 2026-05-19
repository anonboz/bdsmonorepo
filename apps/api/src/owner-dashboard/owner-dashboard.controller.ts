import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { OwnerDashboard } from '@repo/shared';

import { OwnerDashboardService } from './owner-dashboard.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('owner-dashboard')
@ApiBearerAuth()
@Controller('me/owner-dashboard')
export class OwnerDashboardController {
  constructor(private readonly service: OwnerDashboardService) {}

  @Get()
  @Roles('OWNER')
  get(@CurrentUser() user: AuthenticatedUser): Promise<OwnerDashboard> {
    return this.service.getForOwner(user.id);
  }
}
