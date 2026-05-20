import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { JobRating, JobRatingsForJob } from '@repo/shared';

import { CreateJobRatingDto } from './dto/job-ratings.dto.js';
import { JobRatingsService } from './job-ratings.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('job-ratings')
@ApiBearerAuth()
@Controller('me/service-jobs/:id')
export class JobRatingsOwnerController {
  constructor(private readonly service: JobRatingsService) {}

  @Post('rating')
  @Roles('OWNER')
  @HttpCode(201)
  rate(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: CreateJobRatingDto,
  ): Promise<JobRating> {
    return this.service.rateForOwner(user.id, id, body, requestContextFrom(user, req));
  }

  @Get('ratings')
  @Roles('OWNER')
  getState(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<JobRatingsForJob> {
    return this.service.getStateForOwner(user.id, id);
  }
}
