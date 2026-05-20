import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { LeaseRating, LeaseRatingState } from '@repo/shared';

import { CreateLeaseRatingDto } from './dto/ratings.dto.js';
import { RatingsService } from './ratings.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('ratings')
@ApiBearerAuth()
@Controller('me/leases')
export class RatingsTenantController {
  constructor(private readonly service: RatingsService) {}

  @Get(':id/rating-state')
  @Roles('TENANT')
  state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') leaseId: string,
  ): Promise<LeaseRatingState> {
    return this.service.stateForTenant(user.id, leaseId);
  }

  @Post(':id/ratings')
  @Roles('TENANT')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') leaseId: string,
    @Body() body: CreateLeaseRatingDto,
  ): Promise<LeaseRating> {
    return this.service.createForTenant(user.id, user.displayName, leaseId, body);
  }
}
