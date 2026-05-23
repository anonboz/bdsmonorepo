import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import type {
  AdminNotificationStateResponse,
  AdminUser,
  Bill,
  Page,
  Payment,
  Ticket,
} from '@repo/shared';

import { AdminUsersService, type RequestContext } from './admin-users.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  AdminUserListQueryDto,
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

  /**
   * Phase 10.4 — read-only notification-state view for support.
   * Returns the target user's per-(topic, scope) preferences + quiet
   * hours so support can advise without write access from this side.
   */
  @Get(':id/notification-state')
  @Roles('ADMIN')
  getNotificationState(@Param('id') id: string): Promise<AdminNotificationStateResponse> {
    return this.service.getNotificationState(id);
  }

  // ---- Phase 10.7 — read-only support views ----------------------

  @Get(':id/tickets')
  @Roles('ADMIN')
  listTickets(
    @Param('id') id: string,
    @Query() query: AdminUserListQueryDto,
  ): Promise<Page<Ticket>> {
    return this.service.listTicketsForUser(id, query);
  }

  @Get(':id/bills')
  @Roles('ADMIN')
  listBills(@Param('id') id: string, @Query() query: AdminUserListQueryDto): Promise<Page<Bill>> {
    return this.service.listBillsForUser(id, query);
  }

  @Get(':id/payments')
  @Roles('ADMIN')
  listPayments(
    @Param('id') id: string,
    @Query() query: AdminUserListQueryDto,
  ): Promise<Page<Payment>> {
    return this.service.listPaymentsForUser(id, query);
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

  /**
   * GDPR erasure (Phase 9.3). Irreversible — anonymises PII, soft-
   * deletes the User row, purges owned MediaAsset S3 objects, and
   * fires a PostHog person-delete. Self-erasure blocked.
   */
  @Post(':id/erase')
  @Roles('ADMIN')
  @HttpCode(200)
  erase(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: FastifyRequest,
    @Param('id') id: string,
  ): Promise<AdminUser> {
    return this.service.erase(id, contextFrom(user, req));
  }
}

function contextFrom(user: AuthenticatedUser, req: FastifyRequest): RequestContext {
  return {
    actorId: user.id,
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}
