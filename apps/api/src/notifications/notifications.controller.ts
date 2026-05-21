import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { MarkAllReadResponse, Notification, Page, UnreadCountResponse } from '@repo/shared';

import { ListNotificationsQueryDto } from './dto/notifications.dto.js';
import { NotificationsInboxService } from './notifications.inbox.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Notification inbox endpoints. The four roles share the same surface —
 * each user only ever sees their own rows because every query filters
 * on `Notification.userId = ctx.actorId`.
 *
 * Reads (list, get, unread-count) + mutations (mark-read, mark-all)
 * are all role-agnostic; the `@Roles(...)` decorator is required by
 * RolesGuard so we list every role that has a session.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsInboxService) {}

  @Get()
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<Page<Notification>> {
    return this.service.listForUser(user.id, query);
  }

  @Get('unread-count')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountResponse> {
    return this.service.unreadCount(user.id);
  }

  @Post('read-all')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  markAllRead(@CurrentUser() user: AuthenticatedUser): Promise<MarkAllReadResponse> {
    return this.service.markAllRead(user.id);
  }

  @Get(':id')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Notification> {
    return this.service.getForUser(user.id, id);
  }

  @Patch(':id/read')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Notification> {
    return this.service.markRead(user.id, id);
  }
}
