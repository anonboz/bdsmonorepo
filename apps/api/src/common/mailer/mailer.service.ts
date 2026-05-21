import { Injectable } from '@nestjs/common';

import { getMailer, isMailerLive, type MailDelivery, type MailMessage } from './mailer.client.js';

/**
 * Thin NestJS-DI wrapper over the mailer singleton in `mailer.client.ts`.
 * Future modules (8.2 notification fanout) inject this — better-auth
 * keeps calling `getMailer()` directly because it boots outside DI.
 */
@Injectable()
export class MailerService {
  send(message: MailMessage): Promise<MailDelivery> {
    return getMailer()(message);
  }

  /** True iff the active backend actually delivers (Resend or SMTP). */
  isLive(): boolean {
    return isMailerLive();
  }
}
