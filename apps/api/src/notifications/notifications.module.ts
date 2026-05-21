import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller.js';
import { NotificationsInboxService } from './notifications.inbox.service.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsSendWorker } from './notifications.worker.js';
import { env } from '../env.js';
import { QUEUE_NOTIFICATIONS_SEND } from '../queues/queue-names.js';

/**
 * Notifications is `@Global()` so every domain module that emits an
 * event (bills, payments, tickets, service-jobs, payouts, webhooks)
 * can inject `NotificationsService` without an `imports` entry.
 *
 * The worker is conditionally registered — same `API_DISABLE_QUEUES`
 * flag as the other sweepers, so unit tests don't try to spin up a
 * BullMQ worker against an unreachable Redis.
 *
 * Phase 8.3 adds the HTTP surface (`/v1/notifications`) via
 * `NotificationsController` + `NotificationsInboxService`. Reads only —
 * dispatch stays internal.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS_SEND })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsInboxService,
    ...(env.API_DISABLE_QUEUES ? [] : [NotificationsSendWorker]),
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
