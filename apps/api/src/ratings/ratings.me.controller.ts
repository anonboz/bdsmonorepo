import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { LeaseRating, Page, UserRatingSummary } from '@repo/shared';

import { ListLeaseRatingsQueryDto } from './dto/ratings.dto.js';
import { RatingsService } from './ratings.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

/**
 * `/me/ratings*` endpoints — ratings *received* by the caller. No `@Roles`
 * gate: any authenticated user can see what was said about them, regardless
 * of whether they ever rented or rented out.
 */
@ApiTags('ratings')
@ApiBearerAuth()
@Controller('me/ratings')
export class RatingsMeController {
  constructor(private readonly service: RatingsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLeaseRatingsQueryDto,
  ): Promise<Page<LeaseRating>> {
    return this.service.listReceived(user.id, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<UserRatingSummary> {
    return this.service.summaryForUser(user.id);
  }
}
