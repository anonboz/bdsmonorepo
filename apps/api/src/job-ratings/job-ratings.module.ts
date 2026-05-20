import { Module } from '@nestjs/common';

import { JobRatingsOwnerController } from './job-ratings.owner.controller.js';
import { JobRatingsPartnerController } from './job-ratings.partner.controller.js';
import { JobRatingsService } from './job-ratings.service.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [JobRatingsOwnerController, JobRatingsPartnerController],
  providers: [JobRatingsService],
  exports: [JobRatingsService],
})
export class JobRatingsModule {}
