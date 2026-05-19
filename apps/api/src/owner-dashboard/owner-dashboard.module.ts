import { Module } from '@nestjs/common';

import { OwnerDashboardController } from './owner-dashboard.controller.js';
import { OwnerDashboardService } from './owner-dashboard.service.js';

@Module({
  controllers: [OwnerDashboardController],
  providers: [OwnerDashboardService],
})
export class OwnerDashboardModule {}
