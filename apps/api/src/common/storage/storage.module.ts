import { Global, Module } from '@nestjs/common';

import { StorageService } from './storage.service.js';

/**
 * Storage is `@Global()` so domain modules (media, future thumbnail
 * worker, GDPR-erasure script) can inject `StorageService` without an
 * explicit `imports` chain.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
