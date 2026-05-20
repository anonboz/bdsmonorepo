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
@Controller('houses/:houseId/units/:unitId/leases')
export class RatingsOwnerController {
  constructor(private readonly service: RatingsService) {}

  @Get(':id/rating-state')
  @Roles('OWNER')
  state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') leaseId: string,
  ): Promise<LeaseRatingState> {
    return this.service.stateForOwner(user.id, houseId, unitId, leaseId);
  }

  @Post(':id/ratings')
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') leaseId: string,
    @Body() body: CreateLeaseRatingDto,
  ): Promise<LeaseRating> {
    return this.service.createForOwner(user.id, user.displayName, houseId, unitId, leaseId, body);
  }
}
