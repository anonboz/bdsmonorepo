import { Global, Module } from '@nestjs/common';

import { PlatformConfigService } from './platform-config.service.js';

/**
 * `@Global` so ServiceJobsService can inject the platform-config
 * service without an explicit `imports` chain — same shape as the
 * other cross-cutting modules (Mailer, Storage, Analytics,
 * Notifications).
 */
@Global()
@Module({
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
