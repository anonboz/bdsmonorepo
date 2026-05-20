import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { Page, PartnerSummary } from '@repo/shared';

import { ListPartnersQueryDto } from './dto/partners.dto.js';
import { PartnersService } from './partners.service.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

/**
 * Discovery endpoints for the partner marketplace. Authenticated
 * owners + admins only — tenants don't book partners directly in v1.
 */
@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners')
export class PartnersPublicController {
  constructor(private readonly service: PartnersService) {}

  @Get()
  @Roles('OWNER', 'ADMIN')
  list(@Query() query: ListPartnersQueryDto): Promise<Page<PartnerSummary>> {
    return this.service.listPublic(query);
  }

  @Get(':id')
  @Roles('OWNER', 'ADMIN')
  getOne(@Param('id') id: string): Promise<PartnerSummary> {
    return this.service.getPublic(id);
  }
}
