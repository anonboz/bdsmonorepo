import { Module } from '@nestjs/common';

import { CampaignsAdminController } from './campaigns.admin.controller.js';
import { CampaignsExpirySweeper } from './campaigns.expiry-sweeper.js';
import { CampaignsOwnerController } from './campaigns.owner.controller.js';
import { CampaignsPublicController } from './campaigns.public.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { AuditModule } from '../common/audit/audit.module.js';
import { QueuesModule } from '../queues/queues.module.js';

@Module({
  imports: [AuditModule, QueuesModule],
  controllers: [CampaignsOwnerController, CampaignsAdminController, CampaignsPublicController],
  providers: [CampaignsService, CampaignsExpirySweeper],
  exports: [CampaignsService],
})
export class CampaignsModule {}
