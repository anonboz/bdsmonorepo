import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { ErrorCodes } from '@repo/shared';

import { WebhooksService } from './webhooks.service.js';
import { Public } from '../auth/decorators/public.decorator.js';
import { ProblemError } from '../common/errors/problem.error.js';

/**
 * Stripe webhook receiver. `@Public()` because Stripe doesn't carry
 * a session cookie — the gate is signature verification on the raw
 * body (see WebhooksService.handleStripe).
 *
 * Excluded from Swagger to avoid exposing the internal contract.
 */
@ApiExcludeController()
@Public()
@Controller('webhooks/stripe')
export class WebhooksStripeController {
  constructor(private readonly service: WebhooksService) {}

  @Post()
  @HttpCode(200)
  async handle(
    @Req() req: FastifyRequest & { rawBody?: string },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored' }> {
    if (!this.service.isStripeEnabled()) {
      throw new ProblemError({
        status: 503,
        type: ErrorCodes.PAYMENT_PROVIDER_DISABLED,
        title: 'Stripe webhooks not configured on this deployment',
      });
    }
    if (!req.rawBody) {
      // The raw-body parser in main.ts should have populated this.
      throw new ProblemError({
        status: 400,
        type: ErrorCodes.PAYMENT_WEBHOOK_INVALID,
        title: 'Missing request body',
      });
    }
    return this.service.handleStripe(req.rawBody, signature);
  }
}
