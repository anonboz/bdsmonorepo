import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { AuditLogEntry, Page } from '@repo/shared';

import { AdminAuditService } from './admin-audit.service.js';
import { ListAuditLogQueryDto } from './dto/admin.dto.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/audit-log')
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListAuditLogQueryDto): Promise<Page<AuditLogEntry>> {
    return this.service.list(query);
  }
}
