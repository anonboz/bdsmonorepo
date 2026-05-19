import { Module } from '@nestjs/common';

import { LeasesAdminController } from './leases.admin.controller.js';
import { LeasesOwnerController } from './leases.owner.controller.js';
import { LeasesService } from './leases.service.js';
import { LeasesTenantController } from './leases.tenant.controller.js';

@Module({
  controllers: [LeasesOwnerController, LeasesTenantController, LeasesAdminController],
  providers: [LeasesService],
  exports: [LeasesService],
})
export class LeasesModule {}
