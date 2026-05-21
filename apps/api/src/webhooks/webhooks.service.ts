import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes } from '@repo/shared';

import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { StripeService } from '../payments/stripe.service.js';

/**
 * Provider-agnostic webhook handler. Phase 7.3 ships Stripe; 7.4's
 * VNPay IPN drops into the same shape via `handleVnpay()`.
 *
 * Each handler:
 *   1. Verifies the signature (provider-specific).
 *   2. Inserts a `WebhookEvent` row keyed on (provider, eventId).
 *      P2002 = duplicate delivery → return 'duplicate' and 200.
 *   3. Dispatches to a per-event handler in a Prisma `$transaction`.
 *   4. On success: marks the row PROCESSED. On failure: FAILED + error
 *      message persisted, and the error rethrows so Stripe retries.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaInstance,
    private readonly audit: AuditLogger,
    private readonly stripe: StripeService,
  ) {}

  isStripeEnabled(): boolean {
    return this.stripe.isWebhookEnabled();
  }

  /**
   * Top-level Stripe webhook handler called from
   * `POST /v1/webhooks/stripe`. Caller supplies the raw request body
   * and the `Stripe-Signature` header value.
   */
  async handleStripe(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored' }> {
    if (!signature) {
      throw new ProblemError({
        status: 400,
        type: ErrorCodes.PAYMENT_WEBHOOK_INVALID,
        title: 'Missing Stripe-Signature header',
      });
    }
    let event;
    try {
      event = this.stripe.constructEvent(rawBody, signature);
    } catch (err) {
      this.logger.warn(`stripe webhook signature verification failed: ${(err as Error).message}`);
      throw new ProblemError({
        status: 400,
        type: ErrorCodes.PAYMENT_WEBHOOK_INVALID,
        title: 'Webhook signature verification failed',
      });
    }

    // Idempotent insert. The unique constraint on (provider, eventId)
    // is the source of truth — we don't pre-check.
    let webhookRowId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'STRIPE',
          eventId: event.id,
          type: event.type,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
      webhookRowId = row.id;
      await this.audit.writeOnce({
        actorId: null,
        action: 'webhook.received',
        target: `WebhookEvent:${row.id}`,
        meta: { provider: 'STRIPE', type: event.type, eventId: event.id },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`stripe duplicate event ${event.id} (${event.type}) — no-op`);
        // Mark the existing row to record that the duplicate was seen.
        await this.prisma.webhookEvent.updateMany({
          where: { provider: 'STRIPE', eventId: event.id },
          data: { processedAt: new Date() },
        });
        return { status: 'duplicate' };
      }
      throw err;
    }

    try {
      const status = await this.dispatchStripe(event);
      await this.prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return { status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: {
          status: 'FAILED',
          error: message.slice(0, 2000),
          processedAt: new Date(),
        },
      });
      throw err;
    }
  }

  // ---- Stripe event dispatch --------------------------------------

  private async dispatchStripe(
    event: Awaited<ReturnType<StripeService['constructEvent']>>,
  ): Promise<'processed' | 'ignored'> {
    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event);
        return 'processed';
      // Acked-but-ignored events. We persist them so ops can see them
      // in WebhookEvent but don't mutate domain state from here.
      case 'checkout.session.expired':
      case 'payment_intent.payment_failed':
      case 'payment_intent.succeeded':
        return 'ignored';
      default:
        this.logger.log(`stripe event ${event.type} not handled — acknowledged`);
        return 'ignored';
    }
  }

  private async onCheckoutSessionCompleted(event: {
    data: { object: { id: string } };
    id: string;
    type: string;
  }): Promise<void> {
    const session = event.data.object;
    const sessionId = session.id;

    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerRef: { provider: 'STRIPE', providerRef: sessionId } },
      });
      if (!payment) {
        // Session id we don't recognise — possibly a deleted Payment
        // row, or a session created outside our flow. Audit + bail.
        this.logger.warn(`stripe checkout.session.completed for unknown session ${sessionId}`);
        return;
      }
      if (payment.status === 'SUCCEEDED') {
        // Duplicate delivery that slipped past the (provider, eventId)
        // unique constraint (e.g. event id changed via Stripe's
        // re-deliveries). Idempotent no-op.
        return;
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', receivedAt: new Date() },
      });

      const agg = await tx.payment.aggregate({
        where: { billId: payment.billId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
      if (!bill) {
        throw new Error(`Bill ${payment.billId} not found for confirmed payment ${payment.id}`);
      }
      const sum = agg._sum.amount ?? 0;
      const nextStatus: typeof bill.status = sum >= bill.total ? 'PAID' : 'PARTIALLY_PAID';
      await tx.bill.update({ where: { id: bill.id }, data: { status: nextStatus } });

      await this.audit.write(tx, {
        actorId: null,
        action: 'bill.payment.confirmed',
        target: `Payment:${payment.id}`,
        meta: {
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
          provider: 'STRIPE',
          eventId: event.id,
          billPreviousStatus: bill.status,
          billNextStatus: nextStatus,
        },
      });
    });
  }
}
