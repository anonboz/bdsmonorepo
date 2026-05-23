import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminHousesController } from './admin-houses.controller.js';
import { AdminHousesService } from './admin-houses.service.js';
import { AdminMetricsController } from './admin-metrics.controller.js';
import { AdminMetricsService } from './admin-metrics.service.js';
import { AdminPlatformController } from './admin-platform.controller.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import {
  QUEUE_BILLS_GENERATE,
  QUEUE_BILLS_SWEEP,
  QUEUE_CAMPAIGNS_EXPIRY,
  QUEUE_PAYOUTS_RELEASE,
} from '../queues/queue-names.js';

@Module({
  imports: [
    AuditModule,
    // Re-register the four queues so InjectQueue tokens resolve in
    // this module's DI scope. QueuesModule.forRoot wires the actual
    // connection — re-registration is the documented Nest pattern.
    BullModule.registerQueue(
      { name: QUEUE_BILLS_GENERATE },
      { name: QUEUE_BILLS_SWEEP },
      { name: QUEUE_CAMPAIGNS_EXPIRY },
      { name: QUEUE_PAYOUTS_RELEASE },
    ),
  ],
  controllers: [
    AdminUsersController,
    AdminHousesController,
    AdminDashboardController,
    AdminAuditController,
    AdminMetricsController,
    AdminPlatformController,
  ],
  providers: [
    AdminUsersService,
    AdminHousesService,
    AdminDashboardService,
    AdminAuditService,
    AdminMetricsService,
  ],
})
export class AdminModule {}
