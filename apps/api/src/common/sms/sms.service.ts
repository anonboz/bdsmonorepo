import { Injectable, Logger } from '@nestjs/common';

import { getSmsSender } from './sms.client.js';
import type { SmsDelivery, SmsMessage } from './sms.types.js';

/**
 * Phase 11.6 — thin Nest wrapper over the boot-time
 * {@link getSmsSender} singleton. Exists so consumers get DI ergonomics
 * (and a test seam) instead of importing the module-level function
 * directly. The wrapper is intentionally state-free; the singleton
 * lives in `sms.client.ts`.
 *
 * The better-auth `phoneNumber` plugin's `sendOTP` callback is the
 * primary caller — see {@link auth} in `apps/api/src/auth/better-auth.config.ts`.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  async send(message: SmsMessage): Promise<SmsDelivery> {
    const sender = getSmsSender();
    try {
      return await sender(message);
    } catch (err) {
      this.logger.error(
        `SMS send failed to ${message.to}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
