import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { WebhooksService } from './webhooks.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import type { MomoIpnBody } from '../payments/momo.client.js';

/**
 * MoMo Instant Payment Notification handler (Phase 12.1). `@Public()`
 * because MoMo calls us server-to-server with no session cookie — the
 * signed JSON body IS the auth.
 *
 * Path: `POST /v1/webhooks/momo/ipn`. MoMo expects `204 No Content`
 * on success; any non-2xx triggers retries (up to ~5x over ~20 min).
 * Disabled or signature-failing deliveries also 204 so a misconfigured
 * deploy doesn't fan out into the retry storm.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/momo')
export class WebhooksMomoController {
  constructor(private readonly service: WebhooksService) {}

  @Post('ipn')
  @HttpCode(204)
  async ipn(@Body() body: MomoIpnBody): Promise<void> {
    if (!this.service.isMomoEnabled()) {
      // No-op rather than 503 — MoMo would retry on 5xx, which is
      // useless against a deploy that hasn't been credentialed.
      return;
    }
    await this.service.handleMomoIpn(body);
  }
}
