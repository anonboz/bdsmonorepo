import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Application, Page } from '@repo/shared';

import { ApplicationsService } from './applications.service.js';
import { CreateApplicationDto, ListApplicationsQueryDto } from './dto/applications.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('applications')
@ApiBearerAuth()
@Controller('me/applications')
export class ApplicationsTenantController {
  constructor(private readonly service: ApplicationsService) {}

  @Post()
  @Roles('TENANT')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Body() body: CreateApplicationDto,
  ): Promise<Application> {
    return this.service.createForTenant(user.id, body, requestContextFrom(user, req));
  }

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<Page<Application>> {
    return this.service.listForTenant(user.id, query);
  }

  @Get(':id')
  @Roles('TENANT')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Application> {
    return this.service.getForTenant(user.id, id);
  }

  @Post(':id/withdraw')
  @Roles('TENANT')
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ): Promise<Application> {
    return this.service.withdrawForTenant(user.id, id, requestContextFrom(user, req));
  }
}
