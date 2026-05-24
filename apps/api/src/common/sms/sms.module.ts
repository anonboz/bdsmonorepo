import { Module } from '@nestjs/common';

import { SmsService } from './sms.service.js';

/**
 * Phase 11.6 — provides the {@link SmsService} to any module that needs
 * to send SMS. Currently consumed by the better-auth `phoneNumber`
 * plugin's `sendOTP` callback (wired in `apps/api/src/auth/better-auth.config.ts`),
 * which runs outside Nest's DI graph — the module exists so other
 * services (notifications fanout, support tooling) can pull it in.
 */
@Module({
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
