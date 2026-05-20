import { Module } from '@nestjs/common';

import { ServiceJobsOwnerController } from './service-jobs.owner.controller.js';
import { ServiceJobsPartnerController } from './service-jobs.partner.controller.js';
import { ServiceJobsService } from './service-jobs.service.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [ServiceJobsOwnerController, ServiceJobsPartnerController],
  providers: [ServiceJobsService],
  exports: [ServiceJobsService],
})
export class ServiceJobsModule {}
