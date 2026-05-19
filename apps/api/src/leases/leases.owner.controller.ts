import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Lease, Page } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  CreateLeaseDto,
  ListLeasesQueryDto,
  TransitionLeaseDto,
  UpdateLeaseDto,
} from './dto/leases.dto.js';
import { LeasesService } from './leases.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Owner-scoped lease routes. Nested under `/houses/:houseId/units/:unitId`
 * so authorization can layer through the parent house just like Units do.
 */
@ApiTags('leases')
@ApiBearerAuth()
@Controller('houses/:houseId/units/:unitId/leases')
export class LeasesOwnerController {
  constructor(private readonly service: LeasesService) {}

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Body() body: CreateLeaseDto,
  ): Promise<Lease> {
    return this.service.createForUnit(user, houseId, unitId, body);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Query() query: ListLeasesQueryDto,
  ): Promise<Page<Lease>> {
    return this.service.listForUnit(user, houseId, unitId, query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
  ): Promise<Lease> {
    return this.service.getForUnit(user, houseId, unitId, id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
    @Body() body: UpdateLeaseDto,
  ): Promise<Lease> {
    return this.service.updateDraft(user, houseId, unitId, id, body);
  }

  @Post(':id/transitions')
  @Roles('OWNER')
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('unitId') unitId: string,
    @Param('id') id: string,
    @Body() body: TransitionLeaseDto,
  ): Promise<Lease> {
    return this.service.transition(user, houseId, unitId, id, body);
  }
}
