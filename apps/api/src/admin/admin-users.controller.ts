import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type { AdminUser, Page } from '@repo/shared';

import { AdminUsersService, type RequestContext } from './admin-users.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  KycDecisionDto,
  ListAdminUsersQueryDto,
  SuspendUserDto,
  UnsuspendUserDto,
} from './dto/admin.dto.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListAdminUsersQueryDto): Promise<Page<AdminUser>> {
    return this.service.list(query);
  }

  @Get(':id')
  @Roles('ADMIN')
  getOne(@Param('id') id: string): Promise<AdminUser> {
    return this.service.getById(id);
  }

  @Post(':id/suspend')
  @Roles('ADMIN')
  @HttpCode(200)
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: SuspendUserDto,
  ): Promise<AdminUser> {
    return this.service.suspend(id, body, contextFrom(user, req));
  }

  @Post(':id/unsuspend')
  @Roles('ADMIN')
  @HttpCode(200)
  unsuspend(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: UnsuspendUserDto,
  ): Promise<AdminUser> {
    return this.service.unsuspend(id, body, contextFrom(user, req));
  }

  @Post(':id/kyc-decision')
  @Roles('ADMIN')
  @HttpCode(200)
  kycDecision(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
    @Body() body: KycDecisionDto,
  ): Promise<AdminUser> {
    return this.service.kycDecision(id, body, contextFrom(user, req));
  }
}

function contextFrom(user: AuthenticatedUser, req: FastifyRequest): RequestContext {
  return {
    actorId: user.id,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
