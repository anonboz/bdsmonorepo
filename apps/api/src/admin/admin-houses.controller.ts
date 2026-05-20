import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { House, Page } from '@repo/shared';

import { AdminHousesService } from './admin-houses.service.js';
import { type RequestContext } from './admin-users.service.js';
import {
  ClearHouseModerationDto,
  FlagHouseDto,
  ListAdminHousesQueryDto,
  RejectHouseDto,
} from './dto/admin-houses.dto.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/houses')
export class AdminHousesController {
  constructor(private readonly service: AdminHousesService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListAdminHousesQueryDto): Promise<Page<House>> {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles('ADMIN')
  getOne(@Param('id') id: string): Promise<House> {
    return this.service.getById(id);
  }

  @Post(':id/flag')
  @Roles('ADMIN')
  @HttpCode(200)
  flag(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: FlagHouseDto,
  ): Promise<House> {
    return this.service.flag(id, body, contextFrom(user, req));
  }

  @Post(':id/clear')
  @Roles('ADMIN')
  @HttpCode(200)
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: ClearHouseModerationDto,
  ): Promise<House> {
    return this.service.clear(id, body, contextFrom(user, req));
  }

  @Post(':id/reject')
  @Roles('ADMIN')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: RejectHouseDto,
  ): Promise<House> {
    return this.service.reject(id, body, contextFrom(user, req));
  }
}

function contextFrom(user: AuthenticatedUser, req: FastifyRequest): RequestContext {
  return {
    actorId: user.id,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
