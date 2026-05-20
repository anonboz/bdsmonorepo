import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Page, ServiceJob } from '@repo/shared';

import {
  CancelServiceJobDto,
  CompleteServiceJobDto,
  ListServiceJobsQueryDto,
  QuoteServiceJobDto,
} from './dto/service-jobs.dto.js';
import { ServiceJobsService } from './service-jobs.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

@ApiTags('service-jobs')
@ApiBearerAuth()
@Controller('me/jobs')
export class ServiceJobsPartnerController {
  constructor(private readonly service: ServiceJobsService) {}

  @Get()
  @Roles('PARTNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListServiceJobsQueryDto,
  ): Promise<Page<ServiceJob>> {
    return this.service.listForPartner(user.id, query);
  }

  @Get(':id')
  @Roles('PARTNER')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<ServiceJob> {
    return this.service.getForPartner(user.id, id);
  }

  @Post(':id/quote')
  @Roles('PARTNER')
  @HttpCode(200)
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: QuoteServiceJobDto,
  ): Promise<ServiceJob> {
    return this.service.quoteForPartner(user.id, id, body, requestContextFrom(user, req));
  }

  @Post(':id/start')
  @Roles('PARTNER')
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ): Promise<ServiceJob> {
    return this.service.startForPartner(user.id, id, requestContextFrom(user, req));
  }

  @Post(':id/complete')
  @Roles('PARTNER')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: CompleteServiceJobDto,
  ): Promise<ServiceJob> {
    return this.service.completeForPartner(user.id, id, body, requestContextFrom(user, req));
  }

  @Post(':id/cancel')
  @Roles('PARTNER')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: CancelServiceJobDto,
  ): Promise<ServiceJob> {
    return this.service.cancelForPartner(user.id, id, body, requestContextFrom(user, req));
  }
}
