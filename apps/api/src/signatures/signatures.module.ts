import { Module } from '@nestjs/common';

import { SignaturesOwnerController } from './signatures.owner.controller.js';
import { SignaturesService } from './signatures.service.js';
import { SignaturesTenantController } from './signatures.tenant.controller.js';
import { AuditModule } from '../common/audit/audit.module.js';

@Module({
  imports: [AuditModule],
  controllers: [SignaturesTenantController, SignaturesOwnerController],
  providers: [SignaturesService],
  exports: [SignaturesService],
})
export class SignaturesModule {}
