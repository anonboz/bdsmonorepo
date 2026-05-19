import { Module } from '@nestjs/common';

import { TicketsAdminController } from './tickets.admin.controller.js';
import { TicketsOwnerController } from './tickets.owner.controller.js';
import { TicketsService } from './tickets.service.js';
import { TicketsTenantController } from './tickets.tenant.controller.js';

@Module({
  controllers: [TicketsTenantController, TicketsOwnerController, TicketsAdminController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
