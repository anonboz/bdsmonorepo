import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Lease, Page } from '@repo/shared';

import { ListLeasesQueryDto } from './dto/leases.dto.js';
import { LeasesService } from './leases.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Admin-scoped read-any views. No mutations in this slice — admin
 * moderation actions land in Phase 3.
 */
@ApiTags('leases')
@ApiBearerAuth()
@Controller('leases')
export class LeasesAdminController {
  constructor(private readonly service: LeasesService) {}

  @Get()
  @Roles('ADMIN')
  list(@Query() query: ListLeasesQueryDto): Promise<Page<Lease>> {
    return this.service.listAll(query);
  }

  @Get(':id')
  @Roles('ADMIN')
  getOne(@Param('id') id: string): Promise<Lease> {
    return this.service.getAny(id);
  }
}
