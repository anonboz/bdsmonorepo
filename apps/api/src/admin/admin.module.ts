import { Module } from '@nestjs/common';

import { AdminAuditController } from './admin-audit.controller.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditLogger } from './audit-logger.service.js';

@Module({
  controllers: [AdminUsersController, AdminAuditController],
  providers: [AdminUsersService, AdminAuditService, AuditLogger],
  exports: [AuditLogger],
})
export class AdminModule {}
