import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller.js';
import { NotificationsInboxService } from './notifications.inbox.service.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsStuckSweeper } from './notifications.sweeper.js';
import { NotificationsSendWorker } from './notifications.worker.js';
import { PushSender } from './push-sender.js';
import { PushSubscriptionsService } from './push-subscriptions.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { env } from '../env.js';
import {
  QUEUE_NOTIFICATIONS_SEND,
  QUEUE_NOTIFICATIONS_STUCK_SWEEP,
} from '../queues/queue-names.js';

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
  imports: [
    AuditModule,
    BullModule.registerQueue(
      { name: QUEUE_NOTIFICATIONS_SEND },
      { name: QUEUE_NOTIFICATIONS_STUCK_SWEEP },
    ),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsInboxService,
    PushSubscriptionsService,
    PushSender,
    ...(env.API_DISABLE_QUEUES ? [] : [NotificationsSendWorker, NotificationsStuckSweeper]),
  ],
  exports: [NotificationsService, PushSubscriptionsService],
})
export class NotificationsModule {}
