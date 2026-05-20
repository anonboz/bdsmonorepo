import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Application, Page } from '@repo/shared';

import { ApplicationsService } from './applications.service.js';
import { ListApplicationsQueryDto, RejectApplicationDto } from './dto/applications.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

/**
 * Owner-scoped application routes. Nested under the campaign so the
 * authorization layer through the parent house mirrors leases / campaigns.
 */
@ApiTags('applications')
@ApiBearerAuth()
@Controller('houses/:houseId/units/:unitId/campaigns/:campaignId/applications')
export class ApplicationsOwnerController {
  constructor(private readonly service: ApplicationsService) {}

  @Get()
  @Roles('OWNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId') campaignId: string,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Page<Application>> {
    return this.service.listForOwner(user.id, campaignId, query);
  }

  @Get(':id')
  @Roles('OWNER')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('campaignId') campaignId: string,
    @Param('id') id: string,
  ): Promise<Application> {
    return this.service.getForOwner(user.id, campaignId, id);
  }

  @Post(':id/accept')
  @Roles('OWNER')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('campaignId') campaignId: string,
    @Param('id') id: string,
  ): Promise<Application> {
    return this.service.acceptForOwner(user.id, campaignId, id, requestContextFrom(user, req));
  }

  @Post(':id/reject')
  @Roles('OWNER')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('campaignId') campaignId: string,
    @Param('id') id: string,
    @Body() body: RejectApplicationDto,
  ): Promise<Application> {
    return this.service.rejectForOwner(
      user.id,
      campaignId,
      id,
      body,
      requestContextFrom(user, req),
    );
  }
}
