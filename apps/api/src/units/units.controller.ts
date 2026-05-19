import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, Unit } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateUnitDto, ListUnitsQueryDto, UpdateUnitDto } from './dto/units.dto.js';
import { UnitsService } from './units.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Units are nested under their House for clarity in URLs. Authorization
 * derives from the parent House — the service enforces it on every call.
 */
@ApiTags('units')
@ApiBearerAuth()
@Controller('houses/:houseId/units')
export class UnitsController {
  constructor(private readonly service: UnitsService) {}

  @Post()
  @Roles('OWNER')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Body() body: CreateUnitDto,
  ): Promise<Unit> {
    return this.service.create(user, houseId, body);
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Query() query: ListUnitsQueryDto,
  ): Promise<Page<Unit>> {
    return this.service.list(user, houseId, query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('id') id: string,
  ): Promise<Unit> {
    return this.service.getById(user, houseId, id);
  }

  @Patch(':id')
  @Roles('OWNER')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('id') id: string,
    @Body() body: UpdateUnitDto,
  ): Promise<Unit> {
    return this.service.update(user, houseId, id, body);
  }

  @Delete(':id')
  @Roles('OWNER')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('houseId') houseId: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.service.softDelete(user, houseId, id);
  }
}
