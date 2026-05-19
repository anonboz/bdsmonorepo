import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Lease, Page } from '@repo/shared';

import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ListLeasesQueryDto } from './dto/leases.dto.js';
import { LeasesService } from './leases.service.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Tenant-scoped read-only views of the signed-in tenant's own leases.
 * Mounted under `/me/leases` so the URL reads as "my leases".
 */
@ApiTags('leases')
@ApiBearerAuth()
@Controller('me/leases')
export class LeasesTenantController {
  constructor(private readonly service: LeasesService) {}

  @Get()
  @Roles('TENANT')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLeasesQueryDto,
  ): Promise<Page<Lease>> {
    return this.service.listForTenant(user.id, query);
  }

  @Get(':id')
  @Roles('TENANT')
  getOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<Lease> {
    return this.service.getForTenant(user.id, id);
  }
}
