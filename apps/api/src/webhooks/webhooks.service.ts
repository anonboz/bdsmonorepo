import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ErrorCodes, NotificationTopic } from '@repo/shared';

import { AnalyticsService } from '../common/analytics/analytics.service.js';
import { AuditLogger } from '../common/audit/audit-logger.service.js';
import { ProblemError } from '../common/errors/problem.error.js';
import { PRISMA, type PrismaInstance } from '../common/prisma/prisma.token.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { type MomoIpnBody } from '../payments/momo.client.js';
import { MomoService } from '../payments/momo.service.js';
import { StripeService } from '../payments/stripe.service.js';
import { parseVnpayDate, type VnpayIpnResponse } from '../payments/vnpay.client.js';
import { VnpayService } from '../payments/vnpay.service.js';

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
    private readonly vnpay: VnpayService,
    private readonly momo: MomoService,
    private readonly notifications: NotificationsService,
    private readonly analytics: AnalyticsService,
  ) {}

  isStripeEnabled(): boolean {
    return this.stripe.isWebhookEnabled();
  }

  isVnpayEnabled(): boolean {
    return this.vnpay.isEnabled();
  }

  isMomoEnabled(): boolean {
    return this.momo.isEnabled();
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
      case 'checkout.session.completed': {
        const { enqueue, analyticsPayload } = await this.onCheckoutSessionCompleted(event);
        if (enqueue) await enqueue();
        if (analyticsPayload) {
          this.analytics.capture({
            userId: analyticsPayload.tenantId,
            event: 'bill.paid',
            properties: {
              role: 'TENANT',
              bill_id: analyticsPayload.billId,
              amount: analyticsPayload.amount,
              currency: analyticsPayload.currency,
              provider: 'STRIPE',
            },
          });
        }
        return 'processed';
      }
      // Connect (Phase 9.1) — partner onboarding state changes.
      case 'account.updated': {
        await this.onAccountUpdated(event);
        return 'processed';
      }
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

  /**
   * Handles `account.updated` (Stripe Connect). Reconciles the
   * `PartnerProfile.stripeConnectStatus` snapshot against Stripe's
   * canonical `charges_enabled && payouts_enabled` formula. Idempotent
   * — duplicate deliveries land on the same UPDATE and the audit row
   * is keyed off (provider, eventId) at the WebhookEvent layer.
   */
  private async onAccountUpdated(event: {
    data: {
      object: {
        id: string;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
        requirements?: { disabled_reason?: string | null } | null;
      };
    };
    id: string;
    type: string;
  }): Promise<void> {
    const account = event.data.object;
    const partner = await this.prisma.partnerProfile.findUnique({
      where: { stripeConnectAccountId: account.id },
    });
    if (!partner) {
      // Account id we don't recognise — either a deleted partner row
      // or an account created outside our flow. Audit + bail.
      this.logger.warn(`account.updated for unknown stripe account ${account.id}`);
      return;
    }

    const nextStatus: 'ACTIVE' | 'ONBOARDING' | 'RESTRICTED' =
      account.charges_enabled && account.payouts_enabled
        ? 'ACTIVE'
        : account.requirements?.disabled_reason
          ? 'RESTRICTED'
          : 'ONBOARDING';
    if (partner.stripeConnectStatus === nextStatus) return;

    const previousStatus = partner.stripeConnectStatus;
    const becameActive = nextStatus === 'ACTIVE' && !partner.stripeConnectOnboardedAt;
    await this.prisma.$transaction(async (tx) => {
      await tx.partnerProfile.update({
        where: { id: partner.id },
        data: {
          stripeConnectStatus: nextStatus,
          ...(becameActive && { stripeConnectOnboardedAt: new Date() }),
        },
      });
      await this.audit.write(tx, {
        actorId: null,
        action: 'partner.connect.status_changed',
        target: `PartnerProfile:${partner.id}`,
        meta: {
          stripeAccountId: account.id,
          previousStatus,
          nextStatus,
          eventId: event.id,
          chargesEnabled: account.charges_enabled ?? false,
          payoutsEnabled: account.payouts_enabled ?? false,
          disabledReason: account.requirements?.disabled_reason ?? null,
        },
      });
    });
  }

  private async onCheckoutSessionCompleted(event: {
    data: { object: { id: string; payment_intent?: string | { id: string } | null } };
    id: string;
    type: string;
  }): Promise<{
    enqueue: (() => Promise<void>) | null;
    analyticsPayload: {
      tenantId: string;
      billId: string;
      amount: number;
      currency: string;
    } | null;
  }> {
    const session = event.data.object;
    const sessionId = session.id;
    // Stripe types `payment_intent` as `string | PaymentIntent | null`.
    // In real deliveries it's a string; the PaymentIntent object only
    // appears when the caller passes `expand`. Coerce strings; warn on
    // null (would only happen on a $0 session, which we shouldn't be
    // creating).
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerRef: { provider: 'STRIPE', providerRef: sessionId } },
      });
      if (!payment) {
        // Session id we don't recognise — possibly a deleted Payment
        // row, or a session created outside our flow. Audit + bail.
        this.logger.warn(`stripe checkout.session.completed for unknown session ${sessionId}`);
        return { enqueue: null, analyticsPayload: null };
      }
      if (payment.status === 'SUCCEEDED') {
        // Duplicate delivery that slipped past the (provider, eventId)
        // unique constraint (e.g. event id changed via Stripe's
        // re-deliveries). Idempotent no-op.
        return { enqueue: null, analyticsPayload: null };
      }
      if (!paymentIntentId) {
        this.logger.warn(
          `stripe session ${sessionId} completed with no payment_intent — refunds won't work for this payment`,
        );
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          receivedAt: new Date(),
          // Capture the PaymentIntent id for the refund path (7.5).
          providerCaptureRef: paymentIntentId,
        },
      });

      const agg = await tx.payment.aggregate({
        where: { billId: payment.billId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const bill = await tx.bill.findUnique({
        where: { id: payment.billId },
        include: { lease: { select: { tenantId: true } } },
      });
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

      // Only fire bill.paid on the closing transition, same rule as
      // the manual flow. Partial payments don't notify.
      if (nextStatus !== 'PAID') return { enqueue: null, analyticsPayload: null };
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.BILL_PAID,
        recipientId: bill.lease.tenantId,
        data: {
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
          provider: 'STRIPE',
        },
      });
      return {
        enqueue: dispatch.enqueue,
        analyticsPayload: {
          tenantId: bill.lease.tenantId,
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
        },
      };
    });
  }

  // ---- VNPay IPN ---------------------------------------------------

  /**
   * VNPay's Instant Payment Notification. Called server-to-server with
   * a GET carrying signed `vnp_*` query params. We respond with a tiny
   * JSON body — `{ RspCode, Message }` — telling VNPay whether to stop
   * retrying (`00`/`02`) or treat as failure and re-deliver later.
   *
   * Source of truth for bill state transitions on the VN-market rail;
   * the browser return URL never mutates DB state (see the spec).
   */
  async handleVnpayIpn(query: Record<string, string>): Promise<VnpayIpnResponse> {
    if (!this.vnpay.verifyIpn(query)) {
      this.logger.warn(`vnpay IPN signature verification failed`);
      return { RspCode: '97', Message: 'Invalid Signature' };
    }

    const txnRef = query.vnp_TxnRef;
    const responseCode = query.vnp_ResponseCode;
    const transactionNo = query.vnp_TransactionNo ?? 'pending';
    if (!txnRef || !responseCode) {
      return { RspCode: '99', Message: 'Missing required fields' };
    }

    // Stable event id per (txnRef, transactionNo, responseCode) — same
    // delivery from VNPay collides on the unique constraint and we ack
    // with `02 Order already confirmed`.
    const eventId = `${txnRef}-${transactionNo}-${responseCode}`;
    let webhookRowId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'VNPAY',
          eventId,
          type: `vnpay.ipn.${responseCode === '00' ? 'success' : 'failure'}`,
          payload: query,
        },
      });
      webhookRowId = row.id;
      await this.audit.writeOnce({
        actorId: null,
        action: 'webhook.received',
        target: `WebhookEvent:${row.id}`,
        meta: { provider: 'VNPAY', type: query.vnp_OrderInfo ?? '', eventId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`vnpay duplicate IPN ${eventId} — ack as 02`);
        return { RspCode: '02', Message: 'Order already confirmed' };
      }
      throw err;
    }

    try {
      const { response, enqueue, analyticsPayload } = await this.applyVnpayIpn(query);
      await this.prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      if (enqueue) await enqueue();
      if (analyticsPayload) {
        this.analytics.capture({
          userId: analyticsPayload.tenantId,
          event: 'bill.paid',
          properties: {
            role: 'TENANT',
            bill_id: analyticsPayload.billId,
            amount: analyticsPayload.amount,
            currency: analyticsPayload.currency,
            provider: 'VNPAY',
          },
        });
      }
      return response;
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

  private async applyVnpayIpn(query: Record<string, string>): Promise<{
    response: VnpayIpnResponse;
    enqueue: (() => Promise<void>) | null;
    analyticsPayload: {
      tenantId: string;
      billId: string;
      amount: number;
      currency: string;
    } | null;
  }> {
    const txnRef = query.vnp_TxnRef!;
    const vnpAmount = Number(query.vnp_Amount);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerRef: { provider: 'VNPAY', providerRef: txnRef } },
      });
      if (!payment)
        return {
          response: { RspCode: '01', Message: 'Order not found' },
          enqueue: null,
          analyticsPayload: null,
        };

      // VNPay's `vnp_Amount` is `amount * 100`. Our local Payment.amount
      // is in minor units (VND đồng). Compare directly.
      if (vnpAmount !== payment.amount * 100) {
        return {
          response: { RspCode: '04', Message: 'Invalid amount' },
          enqueue: null,
          analyticsPayload: null,
        };
      }
      if (payment.status === 'SUCCEEDED') {
        return {
          response: { RspCode: '02', Message: 'Order already confirmed' },
          enqueue: null,
          analyticsPayload: null,
        };
      }

      if (query.vnp_ResponseCode !== '00') {
        // Failure path — mark FAILED + failureReason; bill stays put.
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: `vnp_ResponseCode=${query.vnp_ResponseCode}`,
          },
        });
        return {
          response: { RspCode: '00', Message: 'Confirm Success' },
          enqueue: null,
          analyticsPayload: null,
        };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          receivedAt: new Date(),
          // Mirror the bank's transaction number into the structured
          // `providerCaptureRef` (used by the 7.5 refund path) AND keep
          // it in `note` for backwards compatibility — earlier ops
          // scripts may grep the note column.
          providerCaptureRef: query.vnp_TransactionNo ?? null,
          // Phase 9.2: persist VNPay's pay-date so the refund call
          // can echo it back as `vnp_TransactionDate`. The IPN delivers
          // it as `vnp_PayDate` in `yyyyMMddHHmmss` Asia/Ho_Chi_Minh.
          providerCaptureDate: parseVnpayDate(query.vnp_PayDate),
          note: query.vnp_TransactionNo
            ? `vnp_TransactionNo=${query.vnp_TransactionNo}`
            : payment.note,
        },
      });

      const agg = await tx.payment.aggregate({
        where: { billId: payment.billId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const bill = await tx.bill.findUnique({
        where: { id: payment.billId },
        include: { lease: { select: { tenantId: true } } },
      });
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
          provider: 'VNPAY',
          txnRef,
          transactionNo: query.vnp_TransactionNo ?? null,
          billPreviousStatus: bill.status,
          billNextStatus: nextStatus,
        },
      });

      const response: VnpayIpnResponse = { RspCode: '00', Message: 'Confirm Success' };
      if (nextStatus !== 'PAID') return { response, enqueue: null, analyticsPayload: null };
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.BILL_PAID,
        recipientId: bill.lease.tenantId,
        data: {
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
          provider: 'VNPAY',
        },
      });
      return {
        response,
        enqueue: dispatch.enqueue,
        analyticsPayload: {
          tenantId: bill.lease.tenantId,
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
        },
      };
    });
  }

  // ---- MoMo IPN (Phase 12.1) --------------------------------------

  /**
   * MoMo's Instant Payment Notification. Called server-to-server with
   * a POST/JSON body. We ack with `204 No Content` whether or not the
   * payment landed — the controller already swallows the response
   * shape so MoMo stops retrying once the delivery is recorded.
   *
   * Source of truth for bill state transitions on the MoMo rail.
   * The browser redirect (`/momo/return` on the tenant app) never
   * mutates DB state; see §6 of the spec.
   */
  async handleMomoIpn(body: MomoIpnBody): Promise<void> {
    if (!this.momo.verifyIpn(body)) {
      this.logger.warn(`momo IPN signature verification failed (orderId=${body.orderId})`);
      // Don't write a WebhookEvent for sig failures — a flood of
      // junk POSTs shouldn't fill the audit table.
      return;
    }

    const eventId = `${body.orderId}-${body.transId}-${body.resultCode}`;
    let webhookRowId: string;
    try {
      const row = await this.prisma.webhookEvent.create({
        data: {
          provider: 'MOMO',
          eventId,
          type: `momo.ipn.${body.resultCode === 0 ? 'success' : 'failure'}`,
          payload: body as unknown as Prisma.InputJsonValue,
        },
      });
      webhookRowId = row.id;
      await this.audit.writeOnce({
        actorId: null,
        action: 'webhook.received',
        target: `WebhookEvent:${row.id}`,
        meta: { provider: 'MOMO', type: body.orderType, eventId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`momo duplicate IPN ${eventId} — ack as 204`);
        return;
      }
      throw err;
    }

    try {
      const { enqueue, analyticsPayload } = await this.applyMomoIpn(body);
      await this.prisma.webhookEvent.update({
        where: { id: webhookRowId },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      if (enqueue) await enqueue();
      if (analyticsPayload) {
        this.analytics.capture({
          userId: analyticsPayload.tenantId,
          event: 'bill.paid',
          properties: {
            role: 'TENANT',
            bill_id: analyticsPayload.billId,
            amount: analyticsPayload.amount,
            currency: analyticsPayload.currency,
            provider: 'MOMO',
          },
        });
      }
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

  private async applyMomoIpn(body: MomoIpnBody): Promise<{
    enqueue: (() => Promise<void>) | null;
    analyticsPayload: {
      tenantId: string;
      billId: string;
      amount: number;
      currency: string;
    } | null;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { provider_providerRef: { provider: 'MOMO', providerRef: body.orderId } },
      });
      if (!payment) {
        this.logger.warn(`momo IPN for unknown orderId ${body.orderId}`);
        return { enqueue: null, analyticsPayload: null };
      }
      if (body.amount !== payment.amount) {
        this.logger.warn(
          `momo IPN amount mismatch: payment.amount=${payment.amount}, ipn.amount=${body.amount}`,
        );
        throw new Error(`momo amount mismatch on ${body.orderId}`);
      }
      if (payment.status === 'SUCCEEDED') {
        return { enqueue: null, analyticsPayload: null };
      }

      if (body.resultCode !== 0) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: `momo.resultCode=${body.resultCode}: ${body.message}`.slice(0, 500),
          },
        });
        return { enqueue: null, analyticsPayload: null };
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          receivedAt: new Date(),
          providerCaptureRef: String(body.transId),
          // Stamp the capture date from MoMo's epoch-ms `responseTime`
          // — used by the refund path (when 12.x adds it).
          providerCaptureDate: new Date(body.responseTime),
          note: `momo.transId=${body.transId}`,
        },
      });

      const agg = await tx.payment.aggregate({
        where: { billId: payment.billId, status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const bill = await tx.bill.findUnique({
        where: { id: payment.billId },
        include: { lease: { select: { tenantId: true } } },
      });
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
          provider: 'MOMO',
          orderId: body.orderId,
          transId: body.transId,
          billPreviousStatus: bill.status,
          billNextStatus: nextStatus,
        },
      });

      if (nextStatus !== 'PAID') return { enqueue: null, analyticsPayload: null };
      const dispatch = await this.notifications.dispatch(tx, {
        topic: NotificationTopic.BILL_PAID,
        recipientId: bill.lease.tenantId,
        data: {
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
          provider: 'MOMO',
        },
      });
      return {
        enqueue: dispatch.enqueue,
        analyticsPayload: {
          tenantId: bill.lease.tenantId,
          billId: bill.id,
          amount: payment.amount,
          currency: payment.currency,
        },
      };
    });
  }
}
