import { Controller, Get, HttpCode, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { WebhooksService } from './webhooks.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import type { VnpayIpnResponse } from '../payments/vnpay.client.js';

/**
 * VNPay Instant Payment Notification handler. `@Public()` because
 * VNPay calls us server-to-server without a session cookie — the
 * signed query string IS the auth.
 *
 * Path: `GET /v1/webhooks/vnpay/ipn?vnp_*=...`. VNPay docs say to
 * answer 200 with `{ "RspCode": "<code>", "Message": "<reason>" }`
 * even on failures — non-2xx triggers retries we don't want.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/vnpay')
export class WebhooksVnpayController {
  constructor(private readonly service: WebhooksService) {}

  @Get('ipn')
  @HttpCode(200)
  async ipn(@Query() query: Record<string, string>): Promise<VnpayIpnResponse> {
    if (!this.service.isVnpayEnabled()) {
      // VNPay's expected shape so they don't retry against a
      // misconfigured deploy — 99 covers "anything unexpected".
      return { RspCode: '99', Message: 'VNPay not configured' };
    }
    return this.service.handleVnpayIpn(query);
  }
}
