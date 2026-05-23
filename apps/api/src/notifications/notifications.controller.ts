import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  notificationTopicSchema,
  type GetQuietHoursResponse,
  type ListNotificationPreferencesResponse,
  type ListPushSubscriptionsResponse,
  type MarkAllReadResponse,
  type Notification,
  type NotificationPreference,
  type NotificationQuietHours,
  type Page,
  type PushSubscription,
  type UnreadCountResponse,
} from '@repo/shared';

import {
  CreatePushSubscriptionDto,
  ListNotificationsQueryDto,
  UpsertNotificationPreferenceDto,
  UpsertQuietHoursDto,
} from './dto/notifications.dto.js';
import { NotificationsInboxService } from './notifications.inbox.service.js';
import { PushSubscriptionsService } from './push-subscriptions.service.js';
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
  constructor(
    private readonly service: NotificationsInboxService,
    private readonly push: PushSubscriptionsService,
  ) {}

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

  // ---- Preferences (Phase 9.4) ------------------------------------

  @Get('preferences')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  listPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListNotificationPreferencesResponse> {
    return this.service.listPreferences(user.id);
  }

  @Put('preferences/:topic')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(200)
  upsertPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('topic') topic: string,
    @Body() body: UpsertNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    // Topic comes from the URL path; validate it against the canonical
    // taxonomy here (the Zod pipe only validates the body). Anything
    // outside the enum lands as a 422 problem so the client gets a
    // structured failure instead of a 404.
    const parsed = notificationTopicSchema.parse(topic);
    return this.service.upsertPreference(user.id, parsed, body.muted, body.scope);
  }

  // ---- Quiet hours (Phase 10.4) -----------------------------------

  @Get('quiet-hours')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  getQuietHours(@CurrentUser() user: AuthenticatedUser): Promise<GetQuietHoursResponse> {
    return this.service.getQuietHours(user.id);
  }

  @Put('quiet-hours')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(200)
  setQuietHours(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpsertQuietHoursDto,
  ): Promise<NotificationQuietHours> {
    return this.service.setQuietHours(user.id, body);
  }

  @Delete('quiet-hours')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(204)
  async clearQuietHours(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.service.clearQuietHours(user.id);
  }

  // ---- Web push subscriptions (Phase 10.5) ------------------------

  @Get('push-subscriptions')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  listPushSubscriptions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListPushSubscriptionsResponse> {
    return this.push.list(user.id);
  }

  @Post('push-subscriptions')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(201)
  createPushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePushSubscriptionDto,
  ): Promise<PushSubscription> {
    return this.push.create(user.id, body);
  }

  @Delete('push-subscriptions/:id')
  @Roles('TENANT', 'OWNER', 'PARTNER', 'ADMIN')
  @HttpCode(204)
  async deletePushSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.push.deleteByIdForUser(user.id, id);
  }
}
