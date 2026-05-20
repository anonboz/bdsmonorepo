import { Module } from '@nestjs/common';

import { TicketMessagesService } from './ticket-messages.service.js';
import { TicketsAdminController } from './tickets.admin.controller.js';
import { TicketsOwnerController } from './tickets.owner.controller.js';
import { TicketsService } from './tickets.service.js';
import { TicketsTenantController } from './tickets.tenant.controller.js';

@Module({
  controllers: [TicketsTenantController, TicketsOwnerController, TicketsAdminController],
  providers: [TicketsService, TicketMessagesService],
  exports: [TicketsService, TicketMessagesService],
})
export class TicketsModule {}
