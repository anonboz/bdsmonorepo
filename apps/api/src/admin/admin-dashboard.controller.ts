import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { PlatformDashboard } from '@repo/shared';

import { AdminDashboardService } from './admin-dashboard.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly service: AdminDashboardService) {}

  @Get()
  @Roles('ADMIN')
  get(): Promise<PlatformDashboard> {
    return this.service.getSnapshot();
  }
}
