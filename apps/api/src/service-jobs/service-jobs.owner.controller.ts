import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Page, ServiceJob } from '@repo/shared';

import {
  CancelServiceJobDto,
  CreateServiceJobDto,
  ListServiceJobsQueryDto,
} from './dto/service-jobs.dto.js';
import { ServiceJobsService } from './service-jobs.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('service-jobs')
@ApiBearerAuth()
@Controller('me/service-jobs')
export class ServiceJobsOwnerController {
  constructor(private readonly service: ServiceJobsService) {}

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Body() body: CreateServiceJobDto,
  ): Promise<ServiceJob> {
    return this.service.createForOwner(user.id, body, requestContextFrom(user, req));
  }

  @Get()
  @Roles('OWNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListServiceJobsQueryDto,
  ): Promise<Page<ServiceJob>> {
    return this.service.listForOwner(user.id, query);
  }

  @Get(':id')
  @Roles('OWNER')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ServiceJob> {
    return this.service.getForOwner(user.id, id);
  }

  @Post(':id/accept')
  @Roles('OWNER')
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ): Promise<ServiceJob> {
    return this.service.acceptForOwner(user.id, id, requestContextFrom(user, req));
  }

  @Post(':id/cancel')
  @Roles('OWNER')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: CancelServiceJobDto,
  ): Promise<ServiceJob> {
    return this.service.cancelForOwner(user.id, id, body, requestContextFrom(user, req));
  }
}
