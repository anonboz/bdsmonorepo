import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { Page, PublicCampaign } from '@repo/shared';

import { CampaignsService } from './campaigns.service.js';
import { ListPublicCampaignsQueryDto } from './dto/campaigns-public.dto.js';
import { Public } from '../auth/decorators/public.decorator.js';

/**
 * Public read-only campaign feed. `@Public()` skips the AuthGuard so
 * SSR pages (and crawlers) can hit this without a session.
 */
@ApiTags('campaigns')
@Public()
@Controller('public/campaigns')
export class CampaignsPublicController {
  constructor(private readonly service: CampaignsService) {}

  @Get()
  list(@Query() query: ListPublicCampaignsQueryDto): Promise<Page<PublicCampaign>> {
    return this.service.listPublic(query);
  }

  @Get(':id')
  getOne(@Param('id') id: string): Promise<PublicCampaign> {
    return this.service.getPublic(id);
  }
}
