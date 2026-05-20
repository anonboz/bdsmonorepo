import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { Campaign, Page } from '@repo/shared';

import { CampaignsService } from './campaigns.service.js';
import {
  CreateCampaignDto,
  ListCampaignsQueryDto,
  TransitionCampaignDto,
  UpdateCampaignDto,
} from './dto/campaigns.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { requestContextFrom } from '../common/audit/request-context.js';

/**
 * Owner-scoped campaign routes. Nested under `/houses/:houseId/units/:unitId`
 * so authorization can layer through the parent house, mirroring leases.
 */
@ApiTags('campaigns')
@ApiBearerAuth()
@Controller('houses/:houseId/units/:unitId/campaigns')
export class CampaignsOwnerController {
  constructor(private readonly service: CampaignsService) {}

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Body() body: CreateCampaignDto,
  ): Promise<Campaign> {
    return this.service.createForUnit(user, houseId, unitId, body);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Query() query: ListCampaignsQueryDto,
  ): Promise<Page<Campaign>> {
    return this.service.listForUnit(user, houseId, unitId, query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
  ): Promise<Campaign> {
    return this.service.getForUnit(user, houseId, unitId, id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
    @Body() body: UpdateCampaignDto,
  ): Promise<Campaign> {
    return this.service.updateDraft(user, houseId, unitId, id, body);
  }

  @Post(':id/transitions')
  @Roles('OWNER')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
    @Body() body: TransitionCampaignDto,
  ): Promise<Campaign> {
    return this.service.transition(user, houseId, unitId, id, body, requestContextFrom(user, req));
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.softDelete(user, houseId, unitId, id);
  }
}
