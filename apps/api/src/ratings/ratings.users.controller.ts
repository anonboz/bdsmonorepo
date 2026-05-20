import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { UserRatingSummary } from '@repo/shared';

import { RatingsService } from './ratings.service.js';

/**
 * Public-ish per-user rating summary. Any authenticated user can call it —
 * prospects browsing campaigns (Phase 4) need to see an owner's score before
 * they decide to apply.
 */
@ApiTags('ratings')
@ApiBearerAuth()
@Controller('users')
export class RatingsUsersController {
  constructor(private readonly service: RatingsService) {}

  @Get(':id/rating-summary')
  summary(@Param('id') userId: string): Promise<UserRatingSummary> {
    return this.service.summaryForUser(userId);
  }
}
