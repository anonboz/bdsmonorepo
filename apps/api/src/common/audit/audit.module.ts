import { Module } from '@nestjs/common';

import { AuditLogger } from './audit-logger.service.js';

/**
 * Provides the `AuditLogger` service to every domain module that needs
 * to record `AuditLog` rows alongside its own mutations. Import it
 * directly — it's tiny and dependency-free beyond Prisma.
 */
@Module({
  providers: [AuditLogger],
  exports: [AuditLogger],
})
export class AuditModule {}
