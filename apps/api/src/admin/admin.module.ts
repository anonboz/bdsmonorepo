import { Module } from '@nestjs/common';

import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminDashboardController } from './admin-dashboard.controller.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminHousesController } from './admin-houses.controller.js';
import { AdminHousesService } from './admin-houses.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [
    AdminUsersController,
    AdminHousesController,
    AdminDashboardController,
    AdminAuditController,
  ],
  providers: [AdminUsersService, AdminHousesService, AdminDashboardService, AdminAuditService],
})
export class AdminModule {}
