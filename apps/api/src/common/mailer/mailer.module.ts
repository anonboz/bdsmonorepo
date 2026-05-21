import { Global, Module } from '@nestjs/common';

import { MailerService } from './mailer.service.js';

/**
 * Mailer is `@Global()` so per-domain modules (Phase 8.2's notification
 * fanout, future receipt-email work) inject `MailerService` without
 * having to import this module per-tree.
 */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailerModule {}
