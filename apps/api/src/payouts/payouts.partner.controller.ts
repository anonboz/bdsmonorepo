import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import type { JobLedgerEntry, Page } from '@repo/shared';

import { ListLedgerEntriesQueryDto } from './dto/payouts.dto.js';
import { PayoutsService } from './payouts.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@ApiTags('payouts')
@ApiBearerAuth()
@Controller('me/payouts')
export class PayoutsPartnerController {
  constructor(private readonly service: PayoutsService) {}

  @Get()
  @Roles('PARTNER')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLedgerEntriesQueryDto,
  ): Promise<Page<JobLedgerEntry>> {
    return this.service.listPayoutsForPartner(user.id, query);
  }
}
