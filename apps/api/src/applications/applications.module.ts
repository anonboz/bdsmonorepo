import { Module } from '@nestjs/common';

import { ApplicationsOwnerController } from './applications.owner.controller.js';
import { ApplicationsService } from './applications.service.js';
import { ApplicationsTenantController } from './applications.tenant.controller.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [ApplicationsTenantController, ApplicationsOwnerController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
