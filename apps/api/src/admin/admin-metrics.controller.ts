import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { MetricsResponse } from '@repo/shared';

import { AdminMetricsService } from './admin-metrics.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly service: AdminMetricsService) {}

  @Get()
  @Roles('ADMIN')
  metrics(): Promise<MetricsResponse> {
    return this.service.getMetrics();
  }
}
