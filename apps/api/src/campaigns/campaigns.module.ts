import { Module } from '@nestjs/common';

import { CampaignsAdminController } from './campaigns.admin.controller.js';
import { CampaignsOwnerController } from './campaigns.owner.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [CampaignsOwnerController, CampaignsAdminController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
