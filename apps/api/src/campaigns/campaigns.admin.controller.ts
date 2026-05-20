import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Campaign, Page } from '@repo/shared';

import { CampaignsService } from './campaigns.service.js';
import {
  ApproveCampaignDto,
  ListAdminCampaignsQueryDto,
  RejectCampaignDto,
} from './dto/campaigns-admin.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

/**
 * Admin moderation queue. Approve / reject act only on PENDING; non-
 * PENDING returns 422 `admin.campaign_not_pending`.
 */
@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('admin/campaigns')
export class CampaignsAdminController {
  constructor(private readonly service: CampaignsService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListAdminCampaignsQueryDto): Promise<Page<Campaign>> {
    return this.service.listAsAdmin(query);
  }

  @Get(':id')
  @Roles('ADMIN')
  getOne(@Param('id') id: string): Promise<Campaign> {
    return this.service.getAny(id);
  }

  @Post(':id/approve')
  @Roles('ADMIN')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() _body: ApproveCampaignDto,
  ): Promise<Campaign> {
    return this.service.approveAsAdmin(id, requestContextFrom(user, req));
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: RejectCampaignDto,
  ): Promise<Campaign> {
    return this.service.rejectAsAdmin(id, body, requestContextFrom(user, req));
  }
}
